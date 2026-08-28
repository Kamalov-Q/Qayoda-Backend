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

const OTP_TEMPLATES = {
  uz: (code: string) =>
    `UyNest mobil ilovasiga kirish uchun tasdiqlash kodi: ${code}. Kodni hech kimga bermang.`,
  // Cyrillic is UCS-2 regardless, so this must stay under 70 characters.
  ru: (code: string) =>
    `Код подтверждения для входа в мобильное приложение UyNest: ${code}`,
} as const;

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
    if (digits.length === 9) return `998${digits}`;
    if (digits.length === 12 && digits.startsWith('998')) return digits;
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
      this.logger.error(
        `SMS to ${this.mask(mobile)} failed: ${this.describe(e)}`,
      );
      throw new ServiceUnavailableException({
        code: 'SMS_SEND_FAILED',
        message: "SMS couldn't be sent",
      });
    }
  }

  async sendOtp(
    phone: string,
    code: string,
    lang: 'uz' | 'ru' = 'uz',
  ): Promise<void> {
    await this.send(phone, OTP_TEMPLATES[lang](code));
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
