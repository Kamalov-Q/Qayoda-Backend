import {
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';
import { User } from 'src/modules/users/entities/user.entity';
import { AuthProvider, UserRole, UserStatus } from 'src/shared/enums';
import { AuthIdentity } from '../entities/auth-identity.entity';

/** Postgres unique_violation. */
const UNIQUE_VIOLATION = '23505';

export interface IdentityInput {
  provider: AuthProvider;
  providerId: string;
  profile?: Record<string, unknown>;
  /** Only set when the provider itself verified it. */
  verifiedEmail?: string | null;
  verifiedPhone?: string | null;
  name?: string | null;
  avatarUrl?: string | null;
  language?: 'uz' | 'ru';
}

@Injectable()
export class IdentityService {
  private readonly logger = new Logger(IdentityService.name);

  constructor(private readonly ds: DataSource) {}

  /**
   * Resolves a provider login to a user, creating or linking as appropriate.
   *
   * Auto-linking happens ONLY on a contact detail the provider itself verified.
   * Telegram passes neither email nor phone, so it always creates a fresh user —
   * which is correct: Telegram display names are freely editable, so matching
   * on one would hand anyone an account takeover.
   */
  async resolve(input: IdentityInput): Promise<{ user: User; isNew: boolean }> {
    try {
      return await this.ds.transaction((m) => this.resolveIn(m, input));
    } catch (e) {
      // Two first-ever logins for the same provider account can race: both miss
      // the lookup, both insert, one loses on uq_identity_provider. The row it
      // collided with is now committed, so a single retry takes the known-identity
      // path. Retrying once beats a 500 on a legitimate double-tap.
      if (this.isUniqueViolation(e)) {
        this.logger.warn(
          `Identity race for ${input.provider}, retrying once`,
        );
        return this.ds.transaction((m) => this.resolveIn(m, input));
      }
      throw e;
    }
  }

  private async resolveIn(
    m: EntityManager,
    input: IdentityInput,
  ): Promise<{ user: User; isNew: boolean }> {
    // 1. Known identity — the common path.
    const existing = await m.findOne(AuthIdentity, {
      where: { provider: input.provider, providerId: input.providerId },
      relations: { user: true },
    });

    if (existing) {
      // The join filters soft-deleted users out, so a null user here means the
      // account was deleted while its identity row survived. Treat it as gone
      // rather than dereferencing null two lines later.
      if (!existing.user) {
        throw new UnauthorizedException({ code: 'ACCOUNT_DELETED' });
      }
      existing.lastUsedAt = new Date();
      if (input.profile) existing.profile = input.profile;
      await m.save(existing);
      return { user: existing.user, isNew: false };
    }

    // 2. Match an existing user on a VERIFIED contact detail.
    const matched = await this.findByVerifiedContact(m, input);

    if (matched) {
      await m.save(
        m.create(AuthIdentity, {
          userId: matched.id,
          provider: input.provider,
          providerId: input.providerId,
          profile: input.profile ?? null,
          lastUsedAt: new Date(),
        }),
      );
      this.logger.log(`Linked ${input.provider} to existing user ${matched.id}`);
      return { user: await this.enrich(m, matched, input), isNew: false };
    }

    // 3. Brand new user.
    const user = await m.save(
      m.create(User, {
        name: input.name ?? null,
        phoneNumber: input.verifiedPhone ? `+${input.verifiedPhone}` : null,
        email: input.verifiedEmail ?? null,
        avatarUrl: input.avatarUrl ?? null,
        language: input.language ?? 'uz',
        role: UserRole.USER,
        status: UserStatus.ACTIVE,
      }),
    );

    await m.save(
      m.create(AuthIdentity, {
        userId: user.id,
        provider: input.provider,
        providerId: input.providerId,
        profile: input.profile ?? null,
        lastUsedAt: new Date(),
      }),
    );

    return { user, isNew: true };
  }

  private async findByVerifiedContact(
    m: EntityManager,
    input: IdentityInput,
  ): Promise<User | null> {
    if (input.verifiedPhone) {
      return m.findOne(User, {
        where: { phoneNumber: `+${input.verifiedPhone}` },
      });
    }
    if (input.verifiedEmail) {
      return m.findOne(User, { where: { email: input.verifiedEmail } });
    }
    return null;
  }

  /** Backfill blanks only — never overwrite what the user set themselves. */
  private async enrich(
    m: EntityManager,
    user: User,
    input: IdentityInput,
  ): Promise<User> {
    let dirty = false;
    if (!user.name && input.name) {
      user.name = input.name;
      dirty = true;
    }
    if (!user.avatarUrl && input.avatarUrl) {
      user.avatarUrl = input.avatarUrl;
      dirty = true;
    }
    if (!user.email && input.verifiedEmail) {
      user.email = input.verifiedEmail;
      dirty = true;
    }
    if (!user.phoneNumber && input.verifiedPhone) {
      user.phoneNumber = `+${input.verifiedPhone}`;
      dirty = true;
    }
    return dirty ? m.save(user) : user;
  }

  /** Attach a provider to the signed-in user's account. */
  async link(userId: string, input: IdentityInput): Promise<AuthIdentity> {
    return this.ds.transaction(async (m) => {
      const taken = await m.findOne(AuthIdentity, {
        where: { provider: input.provider, providerId: input.providerId },
      });
      if (taken) {
        if (taken.userId === userId) return taken;
        throw new ConflictException({
          code: 'IDENTITY_TAKEN',
          message: "Bu hisob boshqa foydalanuvchiga bog'langan",
        });
      }

      const already = await m.findOne(AuthIdentity, {
        where: { userId, provider: input.provider },
      });
      if (already) {
        throw new ConflictException({
          code: 'PROVIDER_ALREADY_LINKED',
          message: "Bu turdagi hisob allaqachon bog'langan",
        });
      }

      const identity = await m.save(
        m.create(AuthIdentity, {
          userId,
          provider: input.provider,
          providerId: input.providerId,
          profile: input.profile ?? null,
          lastUsedAt: new Date(),
        }),
      );

      const user = await m.findOneOrFail(User, { where: { id: userId } });
      await this.enrich(m, user, input);
      return identity;
    });
  }

  async unlink(
    userId: string,
    provider: AuthProvider,
  ): Promise<{ unlinked: true }> {
    return this.ds.transaction(async (m) => {
      const identities = await m.find(AuthIdentity, { where: { userId } });

      // Never let someone remove their last way in.
      if (identities.length <= 1) {
        throw new ConflictException({
          code: 'LAST_IDENTITY',
          message: "Oxirgi kirish usulini o'chirib bo'lmaydi",
        });
      }
      if (!identities.some((i) => i.provider === provider)) {
        throw new ConflictException({
          code: 'IDENTITY_NOT_LINKED',
          message: "Bu hisob bog'lanmagan",
        });
      }

      await m.delete(AuthIdentity, { userId, provider });

      // The contact detail has to go with it. Left behind, it still matches in
      // findByVerifiedContact and silently re-links the provider on next login,
      // which makes unlinking look like it did nothing.
      if (provider === AuthProvider.PHONE) {
        await m.update(User, userId, { phoneNumber: null });
      }
      if (provider === AuthProvider.GOOGLE) {
        await m.update(User, userId, { email: null });
      }

      return { unlinked: true };
    });
  }

  listFor(userId: string): Promise<AuthIdentity[]> {
    return this.ds.getRepository(AuthIdentity).find({
      where: { userId },
      select: {
        id: true,
        provider: true,
        createdAt: true,
        lastUsedAt: true,
      },
      order: { createdAt: 'ASC' },
    });
  }

  private isUniqueViolation(e: unknown): boolean {
    return (
      e instanceof QueryFailedError &&
      (e.driverError as { code?: string })?.code === UNIQUE_VIOLATION
    );
  }
}
