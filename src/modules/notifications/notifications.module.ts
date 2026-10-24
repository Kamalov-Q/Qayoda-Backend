import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { EskizService } from './eskiz.service';
import { EskizBalanceService } from './eskiz-balance.service';

/**
 * Outbound SMS, through Eskiz — the only channel the app pays per message for.
 *
 * AuthModule depends on this to send login codes, so this module must not
 * depend on AuthModule back. The in-app inbox, which does need the auth
 * guards, lives in InboxModule for exactly that reason.
 */
@Module({
  imports: [HttpModule.register({ timeout: 15_000 })],
  providers: [EskizService, EskizBalanceService],
  exports: [EskizService, EskizBalanceService],
})
export class NotificationsModule {}
