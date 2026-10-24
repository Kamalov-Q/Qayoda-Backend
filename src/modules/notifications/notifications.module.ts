import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EskizService } from './eskiz.service';
import { EskizBalanceService } from './eskiz-balance.service';
import { UserNotification } from './entities/user-notification.entity';
import { UserNotificationsService } from './user-notifications.service';
import { UserNotificationsController } from './user-notifications.controller';
import { User } from '../users/entities/user.entity';
import { Video } from '../videos/entities/video.entity';
import { AuthModule } from '../auth/auth.module';

/**
 * Telling people things, by both routes the app has.
 *
 * Outbound SMS — login codes through Eskiz, the only channel with a cost
 * attached — and the in-app inbox, which is rows a client reads rather than
 * pushes a device receives. There is no push infrastructure here yet: no
 * device tokens, no APNs or FCM credentials. The inbox is the half that has
 * to exist first regardless, since a push with nothing to open is a
 * notification that happened to you rather than for you.
 */
@Module({
  imports: [
    HttpModule.register({ timeout: 15_000 }),
    TypeOrmModule.forFeature([UserNotification, User, Video]),
    AuthModule,
  ],
  controllers: [UserNotificationsController],
  providers: [EskizService, EskizBalanceService, UserNotificationsService],
  exports: [EskizService, EskizBalanceService, UserNotificationsService],
})
export class NotificationsModule {}
