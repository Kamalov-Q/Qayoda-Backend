import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { ListingReview } from './review.entity';
import { Listing } from '../listings/entities/listing.entity';
import { User } from '../users/entities/user.entity';
import { ReviewsService } from './reviews.service';
import {
  AdminReviewsController,
  MyReviewsController,
  ReviewsController,
} from './reviews.controller';

/**
 * Star ratings and written reviews on listings. Reads the listings and users
 * tables directly rather than importing their modules — same precedent as
 * ReportsModule: it needs a few columns of each, not their services.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([ListingReview, Listing, User]),
    AuthModule,
  ],
  controllers: [
    ReviewsController,
    MyReviewsController,
    AdminReviewsController,
  ],
  providers: [ReviewsService],
  exports: [ReviewsService],
})
export class ReviewsModule {}
