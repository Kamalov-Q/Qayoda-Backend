import {
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource, IsNull, LessThan, MoreThan, Repository } from 'typeorm';
import { randomInt } from 'crypto';
import * as bcrypt from 'bcrypt';
import { AuthProvider, UserStatus } from 'src/shared/enums';
import { PhoneOtpCode } from '../entities/phone-otp-code.entity';
import { EskizService } from '../../notifications/eskiz.service';
import { IdentityService } from './identity.service';
import { TokenService } from './token.service';

const OTP_TTL_MS = 5 * 60_000;
const RESEND_COOLDOWN_MS = 60_000;
const MAX_ATTEMPTS = 5;
/** Per phone number, on top of the per-IP throttle on the controller. */
const MAX_PER_HOUR = 5;

@Injectable()
export class PhoneAuthService {
  private readonly logger = new Logger(PhoneAuthService.name);

  constructor(
    @InjectRepository(PhoneOtpCode)
    private readonly otps: Repository<PhoneOtpCode>,
    private readonly ds: DataSource,
    private readonly identities: IdentityService,
    private readonly tokens: TokenService,
    private readonly eskiz: EskizService,
  ) {}

  async requestOtp(rawPhone: string, lang: 'uz' | 'ru' = 'uz') {
    const phone = EskizService.normalizePhone(rawPhone);

    // Every SMS costs money, so these limits protect the balance as much as
    // the user. The controller's throttle is per IP, which one attacker with a
    // pool of addresses walks straight through; these are per number.
    const [recent, lastHour] = await Promise.all([
      this.otps.findOne({ where: { phone }, order: { createdAt: 'DESC' } }),
      this.otps.count({
        where: { phone, createdAt: MoreThan(new Date(Date.now() - 3_600_000)) },
      }),
    ]);

    if (recent) {
      const elapsed = Date.now() - recent.createdAt.getTime();
      if (elapsed < RESEND_COOLDOWN_MS) {
        throw new HttpException(
          {
            code: 'OTP_COOLDOWN',
            retryAfter: Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000),
          },
          429,
        );
      }
    }
    if (lastHour >= MAX_PER_HOUR) {
      throw new HttpException(
        { code: 'OTP_RATE_LIMITED', retryAfter: 3600 },
        429,
      );
    }

    // randomInt's upper bound is exclusive, so this is 100000..999999.
    const code = String(randomInt(100_000, 1_000_000));

    // Retire whatever is outstanding first. Without this, the previous code
    // stays live until it expires and the user has two working codes at once.
    await this.otps.update(
      { phone, consumedAt: IsNull() },
      { consumedAt: new Date() },
    );

    await this.otps.save(
      this.otps.create({
        phone,
        codeHash: await bcrypt.hash(code, 10),
        expiresAt: new Date(Date.now() + OTP_TTL_MS),
      }),
    );

    // A returning user's stored language beats the device locale.
    const [existing] = await this.ds.query<{ language: 'uz' | 'ru' }[]>(
      `SELECT language FROM users WHERE phone_number = $1 AND deleted_at IS NULL`,
      [`+${phone}`],
    );

    await this.eskiz.sendOtp(phone, code, existing?.language ?? lang);

    return { sent: true, expiresIn: OTP_TTL_MS / 1000 };
  }

  async verifyOtp(
    rawPhone: string,
    code: string,
    name?: string,
    lang: 'uz' | 'ru' = 'uz',
  ) {
    const phone = EskizService.normalizePhone(rawPhone);

    // Deliberately not wrapped in a transaction. The attempt counter is the
    // only thing standing between a 6-digit code and a brute force, and an
    // increment written inside a transaction that then throws is rolled back
    // with it — the counter never moved and the code never locked. Each
    // statement below is atomic on its own, which is all this needs.
    const row = await this.otps.findOne({
      where: { phone, consumedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });

    if (!row || row.expiresAt < new Date()) {
      throw new UnauthorizedException({ code: 'OTP_INVALID' });
    }
    if (row.attempts >= MAX_ATTEMPTS) {
      throw new UnauthorizedException({ code: 'OTP_LOCKED' });
    }

    if (!(await bcrypt.compare(code, row.codeHash))) {
      // SQL-side increment, so parallel guesses all count.
      await this.otps.increment({ id: row.id }, 'attempts', 1);
      throw new UnauthorizedException({
        code: 'OTP_INVALID',
        attemptsLeft: Math.max(0, MAX_ATTEMPTS - (row.attempts + 1)),
      });
    }

    // Claiming the row is what makes the code single-use: two requests that
    // both hold the right code race here, and only one update lands.
    const claimed = await this.otps.update(
      { id: row.id, consumedAt: IsNull() },
      { consumedAt: new Date() },
    );
    if (claimed.affected !== 1) {
      throw new UnauthorizedException({ code: 'OTP_INVALID' });
    }

    const { user, isNew } = await this.identities.resolve({
      provider: AuthProvider.PHONE,
      providerId: phone,
      verifiedPhone: phone, // OTP proves ownership → safe to auto-link
      name: name ?? null,
      language: lang,
    });

    if (user.status === UserStatus.BANNED) {
      throw new ForbiddenException({ code: 'ACCOUNT_BANNED' });
    }

    return { ...(await this.tokens.issuePair(user)), isNew };
  }

  /** Consumed and expired codes are dead weight; nothing reads them back. */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async purgeExpired(): Promise<void> {
    const { affected } = await this.otps.delete({
      expiresAt: LessThan(new Date(Date.now() - 86_400_000)),
    });
    if (affected) this.logger.log(`Purged ${affected} expired OTP codes`);
  }
}
