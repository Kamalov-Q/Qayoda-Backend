import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Amenity } from './amenity.entity';
import { AmenitiesService } from './amenities.service';
import { AdminAmenitiesController, AmenitiesController } from './amenities.controller';

/**
 * Listing amenities as data, mirroring CategoriesModule. ListingsModule
 * imports this to validate the `properties` keys a listing sends; nothing
 * here imports listings, so there is no cycle — the one listing-table update
 * it makes (stripping a deleted key) is plain SQL.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Amenity]), AuthModule],
  controllers: [AmenitiesController, AdminAmenitiesController],
  providers: [AmenitiesService],
  exports: [AmenitiesService],
})
export class AmenitiesModule {}
