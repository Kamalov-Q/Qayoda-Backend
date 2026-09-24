import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ListingView } from './listing-view.entity';
import { Listing } from '../listings/entities/listing.entity';

export interface ViewResult {
  viewCount: number;
  /** False when this view was already on record, or deliberately not counted. */
  counted: boolean;
}

@Injectable()
export class ViewsService {
  constructor(
    @InjectRepository(ListingView)
    private readonly views: Repository<ListingView>,
    @InjectRepository(Listing) private readonly listings: Repository<Listing>,
  ) {}

  /**
   * Record that someone opened this listing, and say what the count is now.
   *
   * Returns the current number in every case, including the ones it refuses
   * to count — the screen showing it should not have to care why.
   */
  async record(
    listingId: string,
    userId: string | null,
    deviceId: string | null,
  ): Promise<ViewResult> {
    const listing = await this.listings.findOne({
      where: { id: listingId },
      select: { id: true, ownerId: true, viewCount: true },
    });
    if (!listing) throw new NotFoundException('Listing not found');

    // Owners re-reading their own advert would otherwise inflate the only
    // number they are watching.
    if (userId && listing.ownerId === userId) {
      return { viewCount: listing.viewCount, counted: false };
    }

    const key = userId
      ? `u:${userId}`
      : deviceId
        ? `d:${deviceId}`
        : null;

    // No key means nothing to deduplicate on, and an undedupable view is a
    // page-open count wearing a viewer count's name.
    if (!key) return { viewCount: listing.viewCount, counted: false };

    // Signing in makes the guest row a duplicate of the person who just
    // arrived; dropping it keeps one human counted once.
    if (userId && deviceId) {
      await this.views.delete({ listingId, viewerKey: `d:${deviceId}` });
    }

    const { identifiers } = await this.views
      .createQueryBuilder()
      .insert()
      .into(ListingView)
      .values({ listingId, viewerKey: key, userId: userId ?? null })
      .orIgnore()
      .execute();

    // orIgnore returns no identifier when the row was already there.
    const inserted = identifiers.length > 0 && !!identifiers[0];

    // Recounted rather than incremented, because the guest-row cleanup above
    // can also move the number down.
    const viewCount = await this.recount(listingId);
    return { viewCount, counted: inserted };
  }

  /** Recompute and store the listing's distinct-viewer count. */
  private async recount(listingId: string): Promise<number> {
    await this.listings.query(
      `UPDATE listings l
          SET view_count = (SELECT COUNT(*) FROM listing_views
                             WHERE listing_id = $1)
        WHERE l.id = $1`,
      [listingId],
    );

    const row = await this.listings.findOne({
      where: { id: listingId },
      select: { viewCount: true },
    });
    return row?.viewCount ?? 0;
  }
}
