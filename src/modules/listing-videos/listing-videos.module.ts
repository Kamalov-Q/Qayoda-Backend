import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { BunnyModule } from '../videos/bunny.module';
import { Listing } from '../listings/entities/listing.entity';
import { ListingVideo } from './entities/listing-video.entity';
import { ListingVideosService } from './listing-videos.service';
import { ListingVideoController } from './listing-videos.controller';

/**
 * The film on an advert — separate from the reels feature in every way that
 * matters, and sharing the one thing worth sharing: the Bunny pipeline.
 *
 * Does not import VideosModule, and must not. VideosModule imports THIS one,
 * so that the single Bunny webhook can offer a guid to both features without
 * either knowing the other exists.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([ListingVideo, Listing]),
    AuthModule,
    BunnyModule,
  ],
  controllers: [ListingVideoController],
  providers: [ListingVideosService],
  exports: [ListingVideosService],
})
export class ListingVideosModule {}
