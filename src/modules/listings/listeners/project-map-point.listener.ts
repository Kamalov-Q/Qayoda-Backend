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
          await manager.query(
            `
          INSERT INTO listing_map_points
            (listing_id, purpose, category, price, currency, centroid, thumb_url, updated_at)
          SELECT l.id, o.purpose, l.category, o.price, o.currency, l.centroid, li.thumb_url, now()
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
