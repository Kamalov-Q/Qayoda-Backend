import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserNotification } from './entities/user-notification.entity';
import { Listing } from '../listings/entities/listing.entity';
import { ListingImage } from '../listings/entities/listing-image.entity';
import { PushToken } from './entities/push-token.entity';
import { ExpoPushService } from './expo-push.service';
import { UserNotificationsService } from './user-notifications.service';
import { UserNotificationsController } from './user-notifications.controller';
import { User } from '../users/entities/user.entity';
import { Video } from '../videos/entities/video.entity';
import { AuthModule } from '../auth/auth.module';

/**
 * The in-app inbox: rows a client reads, not pushes a device receives.
 *
 * Deliberately separate from NotificationsModule, which carries outbound SMS.
 * The two look like one concern and are not: the SMS sender is what logs
 * people IN, so AuthModule depends on it, while the inbox needs AuthModule's
 * guards to know whose inbox it is. Housing both in one module made that a
 * circular import, and Nest resolves a cycle by handing one side `undefined`.
 *
 * There is no push infrastructure here yet — no device tokens, no APNs or FCM
 * credentials. The inbox is the half that has to exist first regardless,
 * since a push with nothing to open is a notification that happened to you
 * rather than for you.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      UserNotification,
      User,
      Video,
      Listing,
      ListingImage,
      PushToken,
    ]),
    AuthModule,
  ],
  controllers: [UserNotificationsController],
  providers: [UserNotificationsService, ExpoPushService],
  exports: [UserNotificationsService, ExpoPushService],
})
export class InboxModule {}
