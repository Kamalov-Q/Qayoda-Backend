import { Module } from '@nestjs/common';
import { MailModule } from 'src/infra/mail/mail.module';
import { SendOtpEmailListener } from './listeners/send-otp-email.listener';

@Module({
  imports: [MailModule],
  providers: [SendOtpEmailListener],
})
export class NotificationsModule {}
