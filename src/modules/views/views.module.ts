import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { ListingView } from './listing-view.entity';
import { Listing } from '../listings/entities/listing.entity';
import { ViewsService } from './views.service';
import { ViewsController } from './views.controller';

/** Distinct-viewer counts on listings. The live push goes out through
 *  LiveModule's gateway, which comments and ratings share. */
@Module({
  imports: [TypeOrmModule.forFeature([ListingView, Listing]), AuthModule],
  controllers: [ViewsController],
  providers: [ViewsService],
  exports: [ViewsService],
})
export class ViewsModule {}
