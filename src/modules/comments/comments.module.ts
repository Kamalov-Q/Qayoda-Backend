import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { ListingComment, ListingCommentLike } from './comment.entity';
import { Listing } from '../listings/entities/listing.entity';
import { User } from '../users/entities/user.entity';
import { CommentsService } from './comments.service';
import {
  AdminCommentsController,
  CommentsController,
  MyCommentsController,
} from './comments.controller';

/**
 * The thread under a listing — questions, answers and hearts. Reads the
 * listings and users tables directly rather than importing their modules,
 * the same precedent as ReportsModule and ReviewsModule.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      ListingComment,
      ListingCommentLike,
      Listing,
      User,
    ]),
    AuthModule,
  ],
  controllers: [
    CommentsController,
    MyCommentsController,
    AdminCommentsController,
  ],
  providers: [CommentsService],
  exports: [CommentsService],
})
export class CommentsModule {}
