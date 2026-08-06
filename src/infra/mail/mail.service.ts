import { Injectable } from '@nestjs/common';
import { Resend } from 'resend';

@Injectable()
export class MailService {
  private client = new Resend(process.env.RESEND_API_KEY);

  /** Resend refuses any address whose domain is not verified for the account,
   *  so this has to track whatever is verified rather than be hardcoded.
   *  `onboarding@resend.dev` is Resend's sandbox sender: no verification, but
   *  it only delivers to the account owner's own address. Good enough to keep
   *  a fresh clone working locally, never right in production. */
  private from = process.env.MAIL_FROM ?? 'Qayoda <onboarding@resend.dev>';

  async send(params: {
    to: string;
    template: string;
    variables: Record<string, string>;
  }) {
    const { error } = await this.client.emails.send({
      from: this.from,
      to: params.to,
      subject: this.subjectFor(params.template),
      html: `<p>Sizning kodingiz: <strong>${params.variables.code}</strong><p>Kod 10 daqiqa amal qiladi!</p></p>`,
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
