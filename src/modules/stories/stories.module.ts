import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { ChatModule } from '../chat/chat.module';
import { Story, StoryReaction, StoryView } from './story.entity';
import { StoryReport } from './story-report.entity';
import { Listing } from '../listings/entities/listing.entity';
import { User } from '../users/entities/user.entity';
import { StoriesService } from './stories.service';
import {
  AdminStoryReportsController,
  StoriesController,
} from './stories.controller';

/**
 * Stories: public, short-lived posts on the Home screen.
 *
 * Reads the listings and users tables directly rather than importing their
 * modules — the same precedent reports and reviews set. It needs one column
 * of `listings` (who owns it) and four of `users`.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Story,
      StoryView,
      StoryReaction,
      StoryReport,
      Listing,
      User,
    ]),
    AuthModule,
    // Forwarding a story is sending a chat message; the permission check and
    // the attribution both belong to the module that owns messages.
    ChatModule,
  ],
  controllers: [StoriesController, AdminStoryReportsController],
  providers: [StoriesService],
  exports: [StoriesService],
})
export class StoriesModule {}
