import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from '../users/entities/user.entity';
import { UserRole, UserStatus } from '../../shared/enums';
import { EskizService } from '../notifications/eskiz.service';

/**
 * Makes sure the accounts listed in ADMIN_PHONES are admins, on every boot.
 *
 *   ADMIN_PHONES=+998901234567,+998931112233
 *   ADMIN_PASSWORD=...            # optional, see below
 *
 * Idempotent: an account that is already an admin is left alone, so a restart
 * costs one query per phone and changes nothing.
 *
 * Deliberately one-directional — it only ever PROMOTES. Removing a phone from
 * the list does not demote that account: a typo in an env var must not be able
 * to lock every admin out. Demote explicitly with `npm run admin:grant --
 * <phone> --revoke`.
 *
 * ADMIN_PASSWORD is only ever used to fill a gap, never to overwrite:
 *   - the account doesn't exist yet → it is created with this password, so
 *     the dashboard works before anyone has touched the mobile app;
 *   - the account exists without a password (SMS-only so far) → it gets one;
 *   - the account already has a password → untouched, even if they differ.
 * So the env var is a bootstrap credential, not a way to reset anyone's.
 */
@Injectable()
export class AdminSeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AdminSeedService.name);

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const raw = this.config.get<string>('ADMIN_PHONES')?.trim();
    if (!raw) return;

    const password = this.config.get<string>('ADMIN_PASSWORD') || null;
    if (password && password.length < 6) {
      // Same floor as the app's own password rule — a shorter one could never
      // be typed into the login form anyway.
      this.logger.warn('ADMIN_PASSWORD is shorter than 6 characters; ignoring it.');
    }
    const usablePassword = password && password.length >= 6 ? password : null;

    for (const entry of raw.split(',').map((p) => p.trim()).filter(Boolean)) {
      // One bad entry must not stop the rest, and must never stop the server
      // from starting: seeding is a convenience, the API is the product.
      try {
        await this.ensureAdmin(entry, usablePassword);
      } catch (e) {
        this.logger.error(
          `Could not seed admin "${entry}": ${e instanceof Error ? e.message : e}`,
        );
      }
    }
  }

  private async ensureAdmin(entry: string, password: string | null) {
    // Same normalisation the login uses, so the seeded number is exactly the
    // one the login form will look up (stored with its leading plus).
    const phoneNumber = `+${EskizService.normalizePhone(entry)}`;
    const user = await this.users.findOne({ where: { phoneNumber } });

    if (!user) {
      if (!password) {
        this.logger.warn(
          `${this.mask(phoneNumber)} has no account yet — sign in on the app once, ` +
            'or set ADMIN_PASSWORD so the seed can create it.',
        );
        return;
      }
      await this.users.save(
        this.users.create({
          phoneNumber,
          passwordHash: await bcrypt.hash(password, 10),
          name: 'Admin',
          role: UserRole.ADMIN,
          status: UserStatus.ACTIVE,
          language: 'uz',
        }),
      );
      this.logger.log(`Created admin ${this.mask(phoneNumber)}.`);
      return;
    }

    // Only the two columns the seed may touch — narrower than Partial<User>,
    // whose relation fields TypeORM's update() won't accept.
    const patch: { role?: UserRole; passwordHash?: string } = {};
    if (user.role !== UserRole.ADMIN) patch.role = UserRole.ADMIN;
    if (!user.passwordHash && password) {
      patch.passwordHash = await bcrypt.hash(password, 10);
    }
    if (!Object.keys(patch).length) return; // already an admin: the common case

    await this.users.update({ id: user.id }, patch);
    this.logger.log(
      `Seeded ${this.mask(phoneNumber)}: ${[
        patch.role ? 'promoted to ADMIN' : null,
        patch.passwordHash ? 'password set' : null,
      ]
        .filter(Boolean)
        .join(', ')}.`,
    );
  }

  /** Phone numbers are personal data; logs get the prefix and last two digits. */
  private mask(phone: string) {
    return `${phone.slice(0, 6)}***${phone.slice(-2)}`;
  }
}
