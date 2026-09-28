import { Global, Module } from '@nestjs/common';
import { RatingService } from './rating.service';

/**
 * How a listing's stars are decided.
 *
 * Global, like BlocksModule: four modules write something that changes a
 * rating (a review, a listing report, a chat report, and the profile that
 * reads a seller's) and none of them should have to know where the formula
 * lives. It owns no entities — every query is raw SQL over tables other
 * modules already own — so there is nothing here to import in a cycle.
 */
@Global()
@Module({
  providers: [RatingService],
  exports: [RatingService],
})
export class RatingModule {}
