import {
  Body,
  Controller,
  ForbiddenException,
  Headers,
  HttpCode,
  Post,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { ApiExcludeController } from '@nestjs/swagger';
import { timingSafeEqual } from 'crypto';
import { SkipThrottle } from '@nestjs/throttler';
import { TelegramAuthService } from './services/telegram-auth.service';

interface TelegramUpdate {
  message?: {
    text?: string;
    from?: {
      id: number;
      first_name?: string;
      last_name?: string;
      username?: string;
      language_code?: string;
    };
  };
}

@ApiExcludeController()
// Telegram retries updates it gets no 200 for. Throttling this endpoint would
// turn a burst of logins into a retry storm rather than shedding load.
@SkipThrottle()
@Controller('telegram')
export class TelegramWebhookController {
  constructor(
    private readonly telegram: TelegramAuthService,
    private readonly config: ConfigService,
    private readonly http: HttpService,
  ) {}

  /**
   * Public endpoint, so it must authenticate itself. Telegram echoes a secret
   * header you set at registration — without checking it, anyone who finds
   * this URL can forge a login for any Telegram id.
   */
  @Post('webhook')
  @HttpCode(200)
  async webhook(
    @Body() update: TelegramUpdate,
    @Headers('x-telegram-bot-api-secret-token') secret: string,
  ) {
    if (!this.secretMatches(secret)) throw new ForbiddenException();

    const msg = update.message;
    const text = msg?.text ?? '';
    const from = msg?.from;
    if (!from || !text.startsWith('/start')) return { ok: true };

    const token = text.split(' ')[1];
    if (!token) {
      await this.reply(from.id, 'UyNest ilovasi orqali kiring.');
      return { ok: true };
    }

    const ok = await this.telegram.confirmFromBot(token, String(from.id), {
      first_name: from.first_name,
      last_name: from.last_name,
      username: from.username,
      language_code: from.language_code,
    });

    await this.reply(
      from.id,
      ok
        ? '✅ Tasdiqlandi! Ilovaga qayting.'
        : "❌ Havola eskirgan. Ilovada qaytadan urinib ko'ring.",
    );
    return { ok: true };
  }

  /** Constant-time, so the header cannot be recovered byte by byte. */
  private secretMatches(presented: string | undefined): boolean {
    const expected = this.config.getOrThrow<string>('TELEGRAM_WEBHOOK_SECRET');
    if (!presented) return false;
    const a = Buffer.from(presented);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private async reply(chatId: number, text: string): Promise<void> {
    const botToken = this.config.getOrThrow<string>('TELEGRAM_BOT_TOKEN');
    await firstValueFrom(
      this.http.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        chat_id: chatId,
        text,
      }),
    ).catch(() => undefined); // a failed reply must not fail the webhook
  }
}
