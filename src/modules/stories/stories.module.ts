import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Story, StoryReaction, StoryView } from './story.entity';
import { Listing } from '../listings/entities/listing.entity';
import { User } from '../users/entities/user.entity';
import { StoriesService } from './stories.service';
import { StoriesController } from './stories.controller';

/**
 * Stories: public, short-lived posts on the Home screen.
 *
 * Reads the listings and users tables directly rather than importing their
 * modules — the same precedent reports and reviews set. It needs one column
 * of `listings` (who owns it) and four of `users`.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Story, StoryView, StoryReaction, Listing, User]),
    AuthModule,
  ],
  controllers: [StoriesController],
  providers: [StoriesService],
  exports: [StoriesService],
})
export class StoriesModule {}
