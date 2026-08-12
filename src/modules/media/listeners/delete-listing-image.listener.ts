import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { MediaService } from '../media.service';
import { OnEvent } from '@nestjs/event-emitter';
import { withIdempotency } from 'src/shared/events/idempotent.util';

@Injectable()
export class DeleteListingImageListener {
  constructor(
    private readonly dataSource: DataSource,
    private readonly mediaService: MediaService,
  ) {}

  @OnEvent('listing.archived')
  async handleArchived(payload: { listingId: string }, eventId: string) {
    await withIdempotency(
      this.dataSource,
      eventId,
      'delete-listing-images',
      async () => {
        const rows: { url: string; thumb_url: string }[] =
          await this.dataSource.query(
            `SELECT url, thumb_url FROM listing_images WHERE listing_id = $1`,
            [payload.listingId],
          );

        for (const row of rows) {
          await this.mediaService.deleteFromBunny(row.url);
          await this.mediaService.deleteFromBunny(row.thumb_url);
        }
      },
    );
  }

  @OnEvent('media.files_orphaned')
  async handleOrphaned(payload: { urls: string[] }, eventId: string) {
    await withIdempotency(
      this.dataSource,
      eventId,
      'delete-orphaned-files',
      async () => {
        for (const url of payload.urls) {
          await this.mediaService.deleteFromBunny(url);
        }
      },
    );
  }
}
