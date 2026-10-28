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

  /**
   * Archiving used to delete the image FILES from Bunny while keeping the
   * `listing_images` rows, which made archive a one-way door: restore() put
   * the listing back on the map pointing at files that no longer existed, so
   * a seller who took an advert down for a fortnight got it back with every
   * photo broken and no way to tell except by looking.
   *
   * An archive now takes down only what makes the listing FINDABLE — its
   * point or outline on the map, removed by ProjectMapPointListener — and
   * leaves everything that describes it alone. Same for a sale.
   *
   * The cost is that an archived listing's photos keep occupying storage.
   * That is the right way round: storage is cheap and a silently destroyed
   * advert is not, and the files are still reclaimed when they are genuinely
   * orphaned — replaced by an edit — below.
   */
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
