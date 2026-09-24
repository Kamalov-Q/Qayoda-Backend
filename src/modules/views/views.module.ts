import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { ListingView } from './listing-view.entity';
import { Listing } from '../listings/entities/listing.entity';
import { ViewsService } from './views.service';
import { ViewsController } from './views.controller';
import { ViewsGateway } from './views.gateway';

/** Distinct-viewer counts on listings, with live updates over `/listings`. */
@Module({
  imports: [TypeOrmModule.forFeature([ListingView, Listing]), AuthModule],
  controllers: [ViewsController],
  providers: [ViewsService, ViewsGateway],
  exports: [ViewsService],
})
export class ViewsModule {}
