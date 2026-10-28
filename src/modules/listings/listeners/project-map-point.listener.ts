import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { withIdempotency } from 'src/shared/events/idempotent.util';
import { DataSource } from 'typeorm';

interface ListingEventPayload {
  listingId: string;
}

@Injectable()
export class ProjectMapPointListener {
  constructor(private readonly dataSource: DataSource) {}

  @OnEvent('listing.published')
  @OnEvent('listing.geometry_changed')
  @OnEvent('listing.price_changed')
  @OnEvent('listing.images_changed')
  async onChanged(payload: ListingEventPayload, eventId: string) {
    await withIdempotency(
      this.dataSource,
      eventId,
      'project-map-point',
      async () => {
        await this.dataSource.transaction(async (manager) => {
          await manager.query(
            `DELETE FROM listing_map_points WHERE listing_id = $1`,
            [payload.listingId],
          );
          // `synchronize` gives every enum column its own Postgres type named
          // `<table>_<column>_enum`, and Postgres will not implicitly cast
          // between two of them — so purpose is round-tripped through text into
          // this table's own type. Category is plain text in both tables (it
          // became admin-managed data), so it copies across uncast.
          await manager.query(
            `
          INSERT INTO listing_map_points
            (listing_id, purpose, category, price, currency, price_usd, centroid, thumb_url, address, title, sold, updated_at)
          SELECT l.id,
                 o.purpose::text::listing_map_points_purpose_enum,
                 l.category,
                 o.price, o.currency, o.price_usd, l.centroid, li.thumb_url, l.address, l.title,
                 l.status = 'SOLD',
                 now()
          FROM listings l
          JOIN listing_offers o ON o.listing_id = l.id AND o.is_active
          LEFT JOIN listing_images li ON li.listing_id = l.id AND li.is_primary
          WHERE l.id = $1
            AND l.status IN ('ACTIVE', 'SOLD')
            AND l.centroid IS NOT NULL
          `,
            [payload.listingId],
          );
        });
      },
    );
  }

  /**
   * Off the map.
   *
   * Archiving only. The seller took the advert down, so there is nothing to
   * show and nothing worth remembering about where it was — an archive
   * carries no information about the market.
   *
   * The photos and the text stay; only the pin goes.
   */
  @OnEvent('listing.archived')
  async onArchived(payload: ListingEventPayload, eventId: string) {
    await withIdempotency(
      this.dataSource,
      eventId,
      'project-map-point',
      async () => {
        await this.dataSource.query(
          `DELETE FROM listing_map_points WHERE listing_id = $1`,
          [payload.listingId],
        );
      },
    );
  }

  /**
   * Sold: the ROW stays, flagged; the pin is not drawn.
   *
   * This used to share the archive handler and delete the row, which kept
   * the map tidy and destroyed the only record of where a sale happened —
   * irreversibly, since nothing else stores the point once the listing is
   * off the map.
   *
   * So the row is written and `sold` is set, and the viewport query filters
   * it out. The map stays clean for buyers (a sold advert is not something
   * they can act on, and every feature competes for a fixed LIMIT) while the
   * location survives for reporting.
   *
   * A full re-projection rather than `UPDATE ... SET sold = true`: the row
   * may not exist at all. A listing with no centroid never had a pin, and
   * one whose offers were edited in the same breath needs its price
   * refreshed anyway. onChanged's INSERT already handles both, and now
   * includes SOLD rows.
   *
   * `price` on the row stays the ASKING price. What it actually went for is
   * in listing_sales, which this projection deliberately does not read —
   * the viewport endpoint is public.
   */
  @OnEvent('listing.sold')
  async onSold(payload: ListingEventPayload, eventId: string) {
    await this.onChanged(payload, eventId);
  }
}
