import { Injectable } from '@nestjs/common';
import { Resend } from 'resend';

@Injectable()
export class MailService {
  private client = new Resend(process.env.RESEND_API_KEY);

  async send(params: {
    to: string;
    template: string;
    variables: Record<string, string>;
  }) {
    await this.client.emails.send({
      from: 'Qayoda <noreply@qayoda.uz>',
      to: params.to,
      subject: this.subjectFor(params.template),
      html: `<p>Sizning kodingiz: <strong>${params.variables.code}</strong><p>Kod 10 daqiqa amal qiladi!</p></p>`,
    });
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
