import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { EskizService } from './eskiz.service';
import { EskizBalanceService } from './eskiz-balance.service';

/**
 * Outbound messaging. SMS is the only channel: login codes go through Eskiz,
 * and the app has no email anywhere in auth — the address Google hands over
 * is stored as profile data, never written to.
 */
@Module({
  imports: [HttpModule.register({ timeout: 15_000 })],
  providers: [EskizService, EskizBalanceService],
  exports: [EskizService, EskizBalanceService],
})
export class NotificationsModule {}
