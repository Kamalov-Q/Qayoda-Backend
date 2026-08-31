import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { LessThan, Repository } from 'typeorm';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { AuthProvider, UserStatus } from 'src/shared/enums';
import {
  TelegramSession,
  TelegramSessionStatus,
} from '../entities/telegram-session.entity';
import { IdentityService } from './identity.service';
import { TokenService } from './token.service';

const SESSION_TTL_MS = 5 * 60_000;
/** How long a Login Widget payload stays acceptable. */
const WIDGET_MAX_AGE_MS = 60_000;

@Injectable()
export class TelegramAuthService {
  private readonly logger = new Logger(TelegramAuthService.name);

  constructor(
    @InjectRepository(TelegramSession)
    private readonly sessions: Repository<TelegramSession>,
    private readonly config: ConfigService,
    private readonly identities: IdentityService,
    private readonly tokens: TokenService,
  ) {}

  /**
   * Step 1 — the app asks to start a Telegram login.
   * `linkUserId` means "attach Telegram to this account" instead of signing in,
   * which is the only safe way to merge a Telegram identity into an existing user.
   */
  async startSession(linkUserId?: string) {
    const token = randomBytes(24).toString('base64url');
    const botUsername = this.config.getOrThrow<string>('TELEGRAM_BOT_USERNAME');

    await this.sessions.save(
      this.sessions.create({
        token,
        linkUserId: linkUserId ?? null,
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      }),
    );

    return {
      token,
      deepLink: `https://t.me/${botUsername}?start=${token}`,
      // Shown in the UI so the user can confirm they opened the right session.
      shortCode: token.slice(0, 6).toUpperCase(),
      expiresIn: SESSION_TTL_MS / 1000,
    };
  }

  /**
   * Step 2 — called by the bot webhook on `/start <token>`.
   * Server-to-server only; the client never touches this.
   */
  async confirmFromBot(
    token: string,
    telegramId: string,
    profile: Record<string, unknown>,
  ): Promise<boolean> {
    const session = await this.sessions.findOne({ where: { token } });
    if (!session) return false;
    if (session.status !== TelegramSessionStatus.PENDING) return false;
    if (session.expiresAt < new Date()) {
      session.status = TelegramSessionStatus.EXPIRED;
      await this.sessions.save(session);
      return false;
    }

    session.status = TelegramSessionStatus.CONFIRMED;
    session.telegramId = telegramId;
    session.telegramProfile = profile;
    await this.sessions.save(session);
    return true;
  }

  /** Step 3 — the app polls. Single-use: the session is CONSUMED after issuing. */
  async poll(token: string) {
    const session = await this.sessions.findOne({ where: { token } });
    if (!session) throw new NotFoundException({ code: 'SESSION_NOT_FOUND' });

    if (session.status === TelegramSessionStatus.CONSUMED) {
      throw new UnauthorizedException({ code: 'SESSION_CONSUMED' });
    }
    if (session.expiresAt < new Date()) return { status: 'EXPIRED' as const };
    if (session.status !== TelegramSessionStatus.CONFIRMED) {
      return { status: 'PENDING' as const };
    }
    if (!session.telegramId) {
      // CONFIRMED is only ever written together with the id; if they ever come
      // apart, issuing a session for an unknown Telegram account is the one
      // outcome that must not happen.
      throw new UnauthorizedException({ code: 'SESSION_NOT_FOUND' });
    }

    // The app polls every couple of seconds, so two requests overlapping on
    // the moment of confirmation is routine. Claim the session with a
    // conditional update so exactly one of them gets to issue tokens.
    const claimed = await this.sessions.update(
      { id: session.id, status: TelegramSessionStatus.CONFIRMED },
      { status: TelegramSessionStatus.CONSUMED },
    );
    if (claimed.affected !== 1) {
      throw new UnauthorizedException({ code: 'SESSION_CONSUMED' });
    }

    const p = session.telegramProfile ?? {};
    // Kept separate, not joined: the profile model has name + surname, and
    // the onboarding screen only waves a user through without typing when
    // both arrived from the provider.
    const name = (p.first_name as string | undefined)?.trim() || null;
    const surname = (p.last_name as string | undefined)?.trim() || null;

    if (session.linkUserId) {
      await this.identities.link(session.linkUserId, {
        provider: AuthProvider.TELEGRAM,
        providerId: session.telegramId,
        name,
        profile: p,
      });
      return { status: 'LINKED' as const };
    }

    // Note: NO verifiedEmail or verifiedPhone. Telegram proves neither, so this
    // can only match an existing TELEGRAM identity or create a fresh user —
    // it can never merge into someone else's account.
    const { user, isNew } = await this.identities.resolve({
      provider: AuthProvider.TELEGRAM,
      providerId: session.telegramId,
      name,
      surname,
      language: p.language_code === 'ru' ? 'ru' : 'uz',
      profile: p,
    });

    if (user.status === UserStatus.BANNED) {
      throw new ForbiddenException({ code: 'ACCOUNT_BANNED' });
    }

    return {
      status: 'CONFIRMED' as const,
      ...(await this.tokens.issuePair(user)),
      isNew,
    };
  }

  /**
   * Telegram Login Widget verification, for the web admin panel.
   * Different mechanism: Telegram signs the payload with your bot token.
   */
  verifyWidgetPayload(data: Record<string, string>): boolean {
    const { hash, ...rest } = data;
    if (!hash) return false;

    const checkString = Object.keys(rest)
      .sort()
      .map((k) => `${k}=${rest[k]}`)
      .join('\n');

    const secret = createHash('sha256')
      .update(this.config.getOrThrow<string>('TELEGRAM_BOT_TOKEN'))
      .digest();
    const computed = createHmac('sha256', secret)
      .update(checkString)
      .digest('hex');

    const a = Buffer.from(computed, 'hex');
    const b = Buffer.from(hash, 'hex');
    if (a.length !== b.length || !timingSafeEqual(a, b)) return false;

    // Reject stale payloads — a captured one stays valid forever otherwise.
    const age = Date.now() - Number(rest.auth_date ?? 0) * 1000;
    return age >= 0 && age < WIDGET_MAX_AGE_MS;
  }

  @Cron(CronExpression.EVERY_HOUR)
  async purgeExpired(): Promise<void> {
    const { affected } = await this.sessions.delete({
      expiresAt: LessThan(new Date(Date.now() - 86_400_000)),
    });
    if (affected) this.logger.log(`Purged ${affected} Telegram sessions`);
  }
}
