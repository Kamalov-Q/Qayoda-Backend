import {
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { IsNull, LessThan, Not, Repository } from 'typeorm';
import { createHash, randomBytes } from 'crypto';
import { User } from 'src/modules/users/entities/user.entity';
import { UserStatus } from 'src/shared/enums';
import { RefreshToken } from '../entities/refresh-token.entity';
import { JwtAccessGuard } from '../guards/jwt-access.guard';

const ACCESS_TTL = '15m';
const REFRESH_TTL_MS = 30 * 86_400_000;

@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);

  constructor(
    @InjectRepository(RefreshToken)
    private readonly refreshes: Repository<RefreshToken>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async issuePair(user: User, familyId?: string) {
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, role: user.role },
      {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        expiresIn: ACCESS_TTL,
      },
    );

    const raw = randomBytes(48).toString('base64url');
    const family = familyId ?? randomBytes(16).toString('hex');

    await this.refreshes.save(
      this.refreshes.create({
        userId: user.id,
        familyId: family,
        tokenHash: this.hash(raw),
        expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
      }),
    );

    return {
      accessToken,
      refreshToken: `${family}.${raw}`,
      user: {
        id: user.id,
        name: user.name,
        surname: user.surname,
        phoneNumber: user.phoneNumber,
        email: user.email,
        avatarUrl: user.avatarUrl,
        language: user.language,
        role: user.role,
        isVerifiedRealtor: user.isVerifiedRealtor,
        // Derived flag only — the hash itself must never leave the server.
        hasPassword: !!user.passwordHash,
      },
    };
  }

  /** Rotation with reuse detection — a replayed token kills the whole family. */
  async rotate(presented: string) {
    const [familyId, raw] = presented.split('.');
    if (!familyId || !raw) throw new UnauthorizedException();

    const row = await this.refreshes.findOne({
      where: { familyId, tokenHash: this.hash(raw) },
      relations: { user: true },
    });

    // A hash that was never issued in this family: either a forgery or a token
    // from a family that has since been purged. Nothing here is safe to trust.
    if (!row) throw new UnauthorizedException({ code: 'TOKEN_INVALID' });

    // The real replay signal. A rotated token stays in the table with
    // `revokedAt` set, so seeing one presented again means two parties hold
    // tokens from this chain — burn the family and make both sign in.
    if (row.revokedAt) {
      await this.revokeFamily(familyId);
      this.logger.warn(`Refresh token reuse on family ${familyId}; revoked`);
      throw new UnauthorizedException({ code: 'TOKEN_REUSE_DETECTED' });
    }

    if (row.expiresAt < new Date()) {
      throw new UnauthorizedException({ code: 'TOKEN_EXPIRED' });
    }

    // Claiming the row IS the check. A read-then-write let two concurrent
    // refreshes both pass the checks above and walk away with a live session
    // each, which is exactly the state reuse detection exists to prevent.
    const claimed = await this.refreshes.update(
      { id: row.id, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
    if (claimed.affected !== 1) {
      await this.revokeFamily(familyId);
      throw new UnauthorizedException({ code: 'TOKEN_REUSE_DETECTED' });
    }

    // The join drops soft-deleted users, so a null user means the account went
    // away while its tokens did not.
    if (!row.user) {
      throw new UnauthorizedException({ code: 'ACCOUNT_DELETED' });
    }
    if (row.user.status === UserStatus.BANNED) {
      await this.revokeAllFor(row.userId);
      throw new ForbiddenException({ code: 'ACCOUNT_BANNED' });
    }

    return this.issuePair(row.user, familyId);
  }

  /**
   * End every session on the account — refresh tokens AND access tokens.
   *
   * The second half is the part that used to be missing. Revoking refresh
   * rows stops the session being renewed but says nothing about the access
   * token already in the client's memory, which kept working for up to its
   * full 15 minutes. `tokens_valid_from` closes that: JwtAccessGuard rejects
   * anything issued before it, at no extra query cost (see the column).
   *
   * The cache invalidation is not optional. The guard holds account state
   * for 30 seconds, so without it "log out" would take effect somewhere
   * between instantly and half a minute later, depending on when the last
   * request happened to land.
   */
  async revokeAllFor(userId: string): Promise<void> {
    const now = new Date();
    await this.refreshes.update(
      { userId, revokedAt: IsNull() },
      { revokedAt: now },
    );
    await this.users.update(userId, { tokensValidFrom: now });
    JwtAccessGuard.invalidate(userId);
  }

  /**
   * One session, named by its family. Used by the sessions screen.
   *
   * Access tokens are deliberately NOT killed here, and that is the whole
   * difference from revokeAllFor: `tokens_valid_from` is per-ACCOUNT, so
   * setting it to end one device's session would end every device's. Ending
   * one session means its refresh chain stops renewing; the access token it
   * already holds dies on its own within fifteen minutes.
   */
  async revokeSession(userId: string, familyId: string): Promise<void> {
    await this.refreshes.update(
      { userId, familyId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }

  /** Everything except the chain the caller is currently using. */
  async revokeOtherSessions(userId: string, keepFamilyId: string): Promise<void> {
    await this.refreshes.update(
      { userId, familyId: Not(keepFamilyId), revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }

  /**
   * The signed-in devices, one row per sign-in.
   *
   * Grouped by family because a family IS a session: rotation replaces the
   * token and keeps the family, so a device that has been open for a month
   * has thirty-odd rows and is still one entry on this list.
   */
  async listSessions(userId: string, currentFamilyId?: string) {
    const rows = await this.refreshes
      .createQueryBuilder('t')
      .select('t.family_id', 'familyId')
      .addSelect('MIN(t.created_at)', 'startedAt')
      .addSelect('MAX(t.created_at)', 'lastSeenAt')
      .addSelect('MAX(t.expires_at)', 'expiresAt')
      .where('t.user_id = :userId', { userId })
      .andWhere('t.revoked_at IS NULL')
      .andWhere('t.expires_at > now()')
      .groupBy('t.family_id')
      .orderBy('MAX(t.created_at)', 'DESC')
      .getRawMany<{
        familyId: string;
        startedAt: Date;
        lastSeenAt: Date;
        expiresAt: Date;
      }>();

    return rows.map((r) => ({
      ...r,
      // So the UI can label one "this device" and refuse to let you revoke
      // the session you are using by accident.
      current: r.familyId === currentFamilyId,
    }));
  }

  /** The family a presented refresh token belongs to, without rotating it. */
  familyOf(presented: string | undefined): string | undefined {
    return presented?.split('.')[0];
  }

  private async revokeFamily(familyId: string): Promise<void> {
    await this.refreshes.update(
      { familyId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }

  /**
   * Revoked rows have to outlive the token they belong to — that is what makes
   * a replay detectable. Only sweep well past expiry, when a replay could no
   * longer be honoured anyway.
   */
  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async purgeExpired(): Promise<void> {
    const { affected } = await this.refreshes.delete({
      expiresAt: LessThan(new Date(Date.now() - REFRESH_TTL_MS)),
    });
    if (affected) this.logger.log(`Purged ${affected} expired refresh tokens`);
  }

  private hash(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }
}
