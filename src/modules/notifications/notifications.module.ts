import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { MailModule } from 'src/infra/mail/mail.module';
import { EskizService } from './eskiz.service';
import { EskizBalanceService } from './eskiz-balance.service';

/**
 * Outbound messaging. SMS is the only channel with a caller today — the email
 * OTP listener went with the email login flow — but MailService stays wired
 * for the transactional mail that has yet to be written.
 */
@Module({
  imports: [HttpModule.register({ timeout: 15_000 }), MailModule],
  providers: [EskizService, EskizBalanceService],
  exports: [EskizService, EskizBalanceService, MailModule],
})
export class NotificationsModule {}
