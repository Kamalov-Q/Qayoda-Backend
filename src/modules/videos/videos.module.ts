import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';
import { InboxModule } from '../notifications/inbox.module';
import { Video } from './entities/video.entity';
import { VideoLike } from './entities/video-like.entity';
import { VideoView } from './entities/video-view.entity';
import { VideoReport } from './entities/video-report.entity';
import {
  VideoComment,
  VideoCommentLike,
} from './entities/video-comment.entity';
import { Listing } from '../listings/entities/listing.entity';
import { User } from '../users/entities/user.entity';
import { Tariff } from '../billing/entities/tariff.entity';
import { BunnyStreamService } from './bunny-stream.service';
import { VideosService } from './videos.service';
import { VideoEngagementService } from './video-engagement.service';
import { VideoCommentsService } from './video-comments.service';
import { VideoReportsService } from './video-reports.service';
import { VideosMaintenanceService } from './videos.maintenance.service';
import {
  ListingVideosController,
  UserVideosController,
  VideosController,
} from './videos.controller';
import { VideoCommentsController } from './video-comments.controller';
import { VideosWebhookController } from './videos-webhook.controller';
import {
  VideoReportsAdminController,
  VideosAdminController,
} from './videos-admin.controller';

/**
 * Short-form video: the Videos tab, and the clip on a listing.
 *
 * BillingModule is imported for one thing — WalletService, which charges
 * VIDEO_POST at the moment a video becomes public. The listings, users and
 * tariffs tables are read directly rather than through their modules (the
 * same precedent as CommentsModule and ReportsModule): what is needed from
 * them is five columns, not their services.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Video,
      VideoLike,
      VideoView,
      VideoReport,
      VideoComment,
      VideoCommentLike,
      Listing,
      User,
      Tariff,
    ]),
    AuthModule,
    BillingModule,
    // The inbox: a video going live, a like, a comment.
    InboxModule,
  ],
  controllers: [
    VideosController,
    VideoCommentsController,
    ListingVideosController,
    UserVideosController,
    VideosWebhookController,
    VideosAdminController,
    VideoReportsAdminController,
  ],
  providers: [
    BunnyStreamService,
    VideosService,
    VideoEngagementService,
    VideoCommentsService,
    VideoReportsService,
    VideosMaintenanceService,
  ],
  exports: [VideosService, VideoReportsService],
})
export class VideosModule {}
