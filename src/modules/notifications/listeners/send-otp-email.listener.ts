import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectDataSource } from '@nestjs/typeorm';
import { MailService } from 'src/infra/mail/mail.service';
import { withIdempotency } from 'src/shared/events/idempotent.util';
import { DataSource } from 'typeorm';

interface OtpRequestedPayload {
  requestId: string;
  subject: string;
  channel: string;
  purpose: string;
  code: string;
}

@Injectable()
export class SendOtpEmailListener {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly mail: MailService,
  ) {}

  @OnEvent('otp.requested')
  async handle(payload: OtpRequestedPayload, eventId: string) {
    if (payload.channel !== 'EMAIL') return;

    await withIdempotency(this.dataSource, eventId, 'send-otp-email', () =>
      this.mail.send({
        to: payload.subject,
        template: this.templateFor(payload.purpose),
        variables: { code: payload.code },
      }),
    );
  }

  private templateFor(purpose: string) {
    return (
      {
        REGISTER: 'otp-register',
        LOGIN: 'otp-login',
        CHANGE_EMAIL: 'otp-change-email',
        RESET_PASSWORD: 'otp-reset-password',
      }[purpose] ?? 'otp-generic'
    );
  }
}
