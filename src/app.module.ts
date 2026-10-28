import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { typeOrmConfig } from './shared/database/typeorm.config';
import { throttlerConfig } from './shared/security/throttler.config';
import { EventsModule } from './shared/events/events.module';
import { AuthModule } from './modules/auth/auth.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { InboxModule } from './modules/notifications/inbox.module';
import { ListingsModule } from './modules/listings/listings.module';
import { MediaModule } from './modules/media/media.module';
import { ChatModule } from './modules/chat/chat.module';
import { UsersModule } from './modules/users/users.module';
import { AdminModule } from './modules/admin/admin.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { AmenitiesModule } from './modules/amenities/amenities.module';
import { BillingModule } from './modules/billing/billing.module';
import { ReportsModule } from './modules/reports/reports.module';
import { VerificationModule } from './modules/verification/verification.module';
import { LiveModule } from './modules/live/live.module';
import { RatingModule } from './modules/rating/rating.module';
import { ReviewsModule } from './modules/reviews/reviews.module';
import { CommentsModule } from './modules/comments/comments.module';
import { ViewsModule } from './modules/views/views.module';
import { VideosModule } from './modules/videos/videos.module';
import { ListingVideosModule } from './modules/listing-videos/listing-videos.module';
import { FollowsModule } from './modules/follows/follows.module';
import { PriceBidsModule } from './modules/price-bids/price-bids.module';
import { SupportModule } from './modules/support/support.module';
import { BlocksModule } from './modules/blocks/blocks.module';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    HealthModule,
    TypeOrmModule.forRootAsync({ useFactory: typeOrmConfig }),
    ThrottlerModule.forRoot(throttlerConfig),
    EventsModule,
    AuthModule,
    NotificationsModule,
    InboxModule,
    ListingsModule,
    MediaModule,
    ChatModule,
    UsersModule,
    AdminModule,
    CategoriesModule,
    AmenitiesModule,
    BillingModule,
    ReportsModule,
    VerificationModule,
    LiveModule,
    RatingModule,
    ReviewsModule,
    CommentsModule,
    ViewsModule,
    VideosModule,
    ListingVideosModule,
    FollowsModule,
    PriceBidsModule,
    SupportModule,
    BlocksModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
