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
          // between two of them — so the source enums are round-tripped through
          // text into this table's own types. (A shared `enumName` across both
          // entities is not an option: synchronize emits one CREATE TYPE per
          // column and the second collides.)
          await manager.query(
            `
          INSERT INTO listing_map_points
            (listing_id, purpose, category, price, currency, centroid, thumb_url, address, updated_at)
          SELECT l.id,
                 o.purpose::text::listing_map_points_purpose_enum,
                 l.category::text::listing_map_points_category_enum,
                 o.price, o.currency, l.centroid, li.thumb_url, l.address, now()
          FROM listings l
          JOIN listing_offers o ON o.listing_id = l.id AND o.is_active
          LEFT JOIN listing_images li ON li.listing_id = l.id AND li.is_primary
          WHERE l.id = $1 AND l.status = 'ACTIVE' AND l.centroid IS NOT NULL
          `,
            [payload.listingId],
          );
        });
      },
    );
  }

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
}
