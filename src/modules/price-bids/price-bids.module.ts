import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { ChatModule } from '../chat/chat.module';
import { ListingsModule } from '../listings/listings.module';
import { InboxModule } from '../notifications/inbox.module';
import { RatesModule } from '../../shared/rates/rates.module';
import { ListingOffer } from '../listings/entities/listing-offer.entity';
import { PriceBid } from './entities/price-bid.entity';
import { PriceBidsService } from './price-bids.service';
import { PriceBidsController } from './price-bids.controller';
import { CloseBidsOnListingClosedListener } from './listeners/close-bids-on-listing-closed.listener';

/**
 * Price negotiation.
 *
 * A leaf: it imports chat, listings and the inbox, and nothing imports it.
 * That is what keeps it out of every other module's dependency graph — and
 * what means switching it off is deleting one line from AppModule rather
 * than untangling it from the thing it talks to.
 *
 * BlocksService is not imported: BlocksModule is @Global, and ChatModule
 * already holds it behind a forwardRef. Importing it again here would add a
 * second edge into that cycle for no provider we do not already have —
 * FollowsModule sets the same precedent.
 *
 * `listing_offers` is read directly rather than through ListingsService, the
 * same precedent FollowsModule sets for reading two columns of `users`: the
 * only question asked of it is "what is being asked for this", and a facade
 * method per caller is how facades stop being useful.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([PriceBid, ListingOffer]),
    AuthModule,
    ListingsModule,
    // ChatService is exported by ChatModule; the bid posts itself into the
    // thread the two of them already share rather than inventing an inbox.
    ChatModule,
    InboxModule,
    RatesModule,
  ],
  controllers: [PriceBidsController],
  providers: [PriceBidsService, CloseBidsOnListingClosedListener],
  exports: [PriceBidsService],
})
export class PriceBidsModule {}
