import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';
import { withIdempotency } from 'src/shared/events/idempotent.util';
import { PriceBidsService } from '../price-bids.service';

interface ListingEventPayload {
  listingId: string;
}

/**
 * An advert that has stopped being for sale takes its open offers with it.
 *
 * Without this a bidder keeps a live card — amount, countdown, buttons — on
 * something that has dropped off the map, and the seller can still accept a
 * price for a listing nobody can reach. Neither side is told; the bid simply
 * outlives the thing it was for.
 *
 * Two ways that happens, and the bidder is owed a different sentence for
 * each: the seller took the advert down, or the property sold. Both close
 * the same bids, so the reason rides along in the notification's meta rather
 * than becoming a sixth PRICE_BID_* kind — a new kind has to reach every
 * phone before the server may emit it (see the rollout note in
 * sql/2026-10-28-price-bids.sql), and this needs no such coordination.
 *
 * Driven by the EVENT rather than called from ListingsService: PriceBidsModule
 * imports ListingsModule (it needs ListingsFacade to read a listing's owner
 * and status), so a call in the other direction would close the circle. The
 * outbox already carries both events for the map projector, and this is one
 * more reader of them.
 */
@Injectable()
export class CloseBidsOnListingClosedListener {
  constructor(
    private readonly dataSource: DataSource,
    private readonly bids: PriceBidsService,
  ) {}

  @OnEvent('listing.archived')
  async onArchived(payload: ListingEventPayload, eventId: string) {
    await this.close(payload.listingId, eventId, 'ARCHIVED');
  }

  @OnEvent('listing.sold')
  async onSold(payload: ListingEventPayload, eventId: string) {
    await this.close(payload.listingId, eventId, 'SOLD');
  }

  /**
   * Idempotent, like every other listener on these events: the relay may
   * deliver the same event twice, and the second delivery must not re-notify
   * people about bids that were closed the first time.
   *
   * The marker keeps its original name although the class no longer does.
   * Renaming it would make every event already processed in production look
   * unprocessed and invite a replay for nothing — harmless when it happens
   * (there are no open bids left to close) but not worth asking for.
   */
  private close(
    listingId: string,
    eventId: string,
    reason: 'ARCHIVED' | 'SOLD',
  ) {
    return withIdempotency(
      this.dataSource,
      eventId,
      'close-bids-on-archive',
      async () => {
        await this.bids.closeOpenBidsFor(listingId, reason);
      },
    );
  }
}
