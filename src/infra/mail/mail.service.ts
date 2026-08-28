import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Resend } from 'resend';

@Injectable()
export class MailService {
  private client?: Resend;

  /** Resend refuses any address whose domain is not verified for the account,
   *  so this has to track whatever is verified rather than be hardcoded.
   *  `onboarding@resend.dev` is Resend's sandbox sender: no verification, but
   *  it only delivers to the account owner's own address. Good enough to keep
   *  a fresh clone working locally, never right in production. */
  private readonly from =
    process.env.MAIL_FROM ?? 'uyNest <onboarding@resend.dev>';

  /**
   * Built on first send, not at construction. `new Resend(undefined)` throws,
   * and as a field initializer that took the whole application down at boot —
   * over a key nothing needs until something actually sends mail.
   */
  private getClient(): Resend {
    if (!this.client) {
      const key = process.env.RESEND_API_KEY;
      if (!key) {
        throw new ServiceUnavailableException(
          'RESEND_API_KEY is not set; email cannot be sent',
        );
      }
      this.client = new Resend(key);
    }
    return this.client;
  }

  async send(params: {
    to: string;
    template: string;
    variables: Record<string, string>;
  }) {
    const { error } = await this.getClient().emails.send({
      from: this.from,
      to: params.to,
      subject: this.subjectFor(params.template),
      html: `<p>Sizning kodingiz: <strong>${params.variables.code}</strong></p><p>Kod 10 daqiqa amal qiladi!</p>`,
    });

    // The SDK resolves rather than throws on API errors. Left unchecked, a
    // failed send still counts as delivered and the event is marked processed.
    if (error) {
      throw new Error(`Resend refused the message: ${error.message}`);
    }
  }

  private subjectFor(template: string) {
    const subjects: Record<string, string> = {
      'otp-register': "Ro'yxatdan o'tishni tasdiqlang",
      'otp-login': 'Kirish kodingiz',
      'otp-change-email': "Email o'zgartirishni tasdiqlang",
      'otp-reset-password': 'Parolni tiklash kodi',
    };
    return subjects[template] ?? 'Tasdiqlash kodi';
  }
}
