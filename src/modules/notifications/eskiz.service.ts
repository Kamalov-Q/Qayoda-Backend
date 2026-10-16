import { HttpService } from '@nestjs/axios';
import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

/**
 * These MUST match your moderated Eskiz templates character for character.
 * Copy-paste from the "Mening matnlarim" table rather than retyping.
 *
 * The apostrophe is plain ASCII ' on purpose. A typographic ' (U+2019) is not
 * in GSM-7, which flips the message to UCS-2 and drops the limit from 160 to
 * 70 characters — doubling the cost of every single login.
 */
interface EskizLoginResponse {
  data?: { token?: string };
}

interface EskizSendResponse {
  id?: string;
  status?: string;
  message?: string;
}

interface EskizLimitResponse {
  data?: { balance?: number };
}

type Lang = 'uz' | 'ru';

/**
 * What the code is for. Signing in and recovering a lost password are
 * separate moderated texts at Eskiz, and the wording is the only thing that
 * tells the reader which one they asked for — a "kirish uchun" code arriving
 * when you pressed "forgot password" reads like someone else is signing in.
 */
export type OtpPurpose = 'login' | 'reset';

/**
 * Copied character for character from the approved rows in my.eskiz.uz →
 * СМС → Мои тексты. Eskiz matches the text it is sent against the
 * moderated one: a single extra word — "mobil", "мобильное" — makes it an
 * unmoderated text and the send is refused. Change a word here only together
 * with a new approval there.
 *
 * Character counts are with a 6-digit code. Latin is GSM-7 (160 per SMS);
 * Cyrillic is UCS-2 (70 per SMS), so both Russian texts cost two — as
 * moderated, and not something a shorter wording here may "fix".
 */
const OTP_TEMPLATES: Record<OtpPurpose, Record<Lang, (code: string) => string>> =
  {
    // Rows 95587 (uz) and 95588 (ru).
    login: {
      // 85 characters — one SMS.
      uz: (code) =>
        `Growen City ilovasiga kirish uchun tasdiqlash kodi: ${code}. Kodni hech kimga bermang.`,
      // 91 characters — two SMS.
      ru: (code) =>
        `Код подтверждения для входа в приложение Growen City: ${code}. Никому не сообщайте этот код.`,
    },
    // Rows 95589 (uz) and 95590 (ru).
    reset: {
      // 77 characters — one SMS.
      uz: (code) =>
        `Growen City ilovasida parolni tiklash kodi: ${code}. Kodni hech kimga bermang.`,
      // 85 characters — two SMS.
      ru: (code) =>
        `Код для сброса пароля в приложении Growen City: ${code}. Никому не сообщайте этот код.`,
    },
  };

/** Eskiz's refusal for a text that has not passed moderation. */
class TemplateNotApprovedError extends Error {}

/** Eskiz answers an unmoderated text with Russian prose, not a code. */
const isModerationRefusal = (detail: string) =>
  /модерац|moderat|шаблон/i.test(detail);

@Injectable()
export class EskizService {
  private readonly logger = new Logger(EskizService.name);
  private token: string | null = null;
  private tokenExpiresAt = 0;

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  private get baseUrl(): string {
    return (
      this.config.get<string>('ESKIZ_BASE_URL') ?? 'https://notify.eskiz.uz/api'
    );
  }

  /**
   * Eskiz tokens last ~30 days. Cached in memory — a restart just re-logs in,
   * which is cheap and avoids persisting a credential.
   */
  private async getToken(force = false): Promise<string> {
    if (!force && this.token && Date.now() < this.tokenExpiresAt) {
      return this.token;
    }

    const body = new URLSearchParams({
      email: this.config.getOrThrow<string>('ESKIZ_EMAIL'),
      password: this.config.getOrThrow<string>('ESKIZ_PASSWORD'),
    });

    try {
      const { data } = await firstValueFrom(
        this.http.post<EskizLoginResponse>(`${this.baseUrl}/auth/login`, body, {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 10_000,
        }),
      );

      const token = data?.data?.token;
      if (!token) throw new Error('No token in Eskiz response');

      this.token = token;
      // Refresh a day early rather than trusting the stated expiry exactly.
      this.tokenExpiresAt = Date.now() + 29 * 24 * 60 * 60 * 1000;
      return token;
    } catch (e) {
      this.logger.error(`Eskiz login failed: ${this.describe(e)}`);
      throw new ServiceUnavailableException({
        code: 'SMS_UNAVAILABLE',
        message: 'Eskiz is unavailable',
      });
    }
  }

  /**
   * Eskiz expects 998901234567 — no plus, no spaces, no dashes.
   * Accepts +998 90 123 45 67, 998901234567, or 901234567.
   */
  static normalizePhone(input: string): string {
    const digits = input.replace(/\D/g, '');
    const local =
      digits.length === 9
        ? digits
        : digits.length === 12 && digits.startsWith('998')
          ? digits.slice(3)
          : null;
    // Same operator rule as the DTOs: 9 digits behind a prefix that is
    // actually in service. An SMS to a number that cannot exist still costs
    // money, so this is a balance guard as much as validation.
    if (local && /^(20|33|50|55|77|88|9\d)\d{7}$/.test(local)) {
      return `998${local}`;
    }
    // A user-supplied value, so this has to surface as a 400. A plain Error
    // here reached the client as a 500 and read as an outage on our side.
    throw new BadRequestException({
      code: 'PHONE_INVALID',
      message: "Telefon raqami noto'g'ri",
    });
  }

  async send(phone: string, message: string): Promise<{ id?: string }> {
    const mobile = EskizService.normalizePhone(phone);
    let token = await this.getToken();

    const body = new URLSearchParams({
      mobile_phone: mobile,
      message,
      from: this.config.get<string>('ESKIZ_FROM') ?? '4546',
    });

    const post = (t: string) =>
      firstValueFrom(
        this.http.post<EskizSendResponse>(
          `${this.baseUrl}/message/sms/send`,
          body,
          {
            headers: {
              Authorization: `Bearer ${t}`,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            timeout: 15_000,
          },
        ),
      );

    try {
      const { data } = await post(token);
      this.logger.log(`SMS queued for ${this.mask(mobile)}`);
      return { id: data?.id };
    } catch (e) {
      // 401 means the cached token died early — retry once with a fresh one.
      if (this.status(e) === 401) {
        token = await this.getToken(true);
        const { data } = await post(token);
        return { id: data?.id };
      }
      const detail = this.describe(e);
      if (isModerationRefusal(detail)) {
        // Not an outage: this exact text isn't approved yet. Surfaced as its
        // own type so sendOtp can log what to fix instead of "SMS failed".
        throw new TemplateNotApprovedError(detail);
      }
      this.logger.error(`SMS to ${this.mask(mobile)} failed: ${detail}`);
      throw new ServiceUnavailableException({
        code: 'SMS_SEND_FAILED',
        message: "SMS couldn't be sent",
      });
    }
  }

  async sendOtp(
    phone: string,
    code: string,
    lang: Lang = 'uz',
    purpose: OtpPurpose = 'login',
  ): Promise<void> {
    try {
      await this.send(phone, OTP_TEMPLATES[purpose][lang](code));
    } catch (e) {
      if (!(e instanceof TemplateNotApprovedError)) throw e;
      // There is no second text to fall back to: sending a different one
      // would deliver a code under a brand name nobody recognises. The text
      // above has drifted from the moderated one — fix it, don't paper over it.
      this.logger.error(
        `OTP text (${purpose}/${lang}) rejected as unmoderated by Eskiz: ` +
          `${e.message}. It must match the approved row in ` +
          'my.eskiz.uz → СМС → Мои тексты exactly.',
      );
      throw new ServiceUnavailableException({
        code: 'SMS_SEND_FAILED',
        message: "SMS couldn't be sent",
      });
    }
  }

  async getBalance(): Promise<number> {
    const token = await this.getToken();
    const { data } = await firstValueFrom(
      this.http.get<EskizLimitResponse>(`${this.baseUrl}/user/get-limit`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 10_000,
      }),
    );
    return Number(data?.data?.balance ?? 0);
  }

  /** Never log a full number — it's personal data sitting in log files. */
  private mask(phone: string): string {
    return `${phone.slice(0, 5)}***${phone.slice(-2)}`;
  }

  private status(e: unknown): number | undefined {
    return (e as { response?: { status?: number } })?.response?.status;
  }

  private describe(e: unknown): string {
    const err = e as { response?: { data?: unknown }; message?: string };
    return JSON.stringify(err.response?.data ?? err.message ?? e);
  }
}
