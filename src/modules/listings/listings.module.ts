import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Listing } from './entities/listing.entity';
import { ListingOffer } from './entities/listing-offer.entity';
import { ListingImage } from './entities/listing-image.entity';
import { ListingMapPoint } from './entities/listing-map-point.entity';
import { ListingSave } from './entities/listing-save.entity';
import { ListingsMapController } from './listings-map.controller';
import { ListingsController } from './listings.controller';
import { ListingRepository } from './repositories/listing.repository';
import { ListingOfferRepository } from './repositories/listing-offer.repository';
import { ListingMapPointRepository } from './repositories/listing-map-point.repository';
import { ListingSaveRepository } from './repositories/listing-save.repository';
import { ListingsService } from './listings.service';
import { ListingsGeoService } from './listings-geo.service';
import { ListingsFacade } from './listings.facade';
import { ListingOwnershipGuard } from './guards/listing-ownership.guard';
import { ProjectMapPointListener } from './listeners/project-map-point.listener';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Listing,
      ListingOffer,
      ListingImage,
      ListingMapPoint,
      ListingSave,
    ]),
    AuthModule,
  ],
  controllers: [ListingsMapController, ListingsController],
  providers: [
    ListingRepository,
    ListingOfferRepository,
    ListingMapPointRepository,
    ListingSaveRepository,
    ListingsService,
    ListingsGeoService,
    ListingsFacade,
    ListingOwnershipGuard,
    ProjectMapPointListener,
  ],
  exports: [ListingsFacade]
})
export class ListingsModule {}
