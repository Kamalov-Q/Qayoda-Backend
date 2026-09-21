import { Injectable, NotFoundException } from '@nestjs/common';
import { ListingRepository } from './repositories/listing.repository';
import { ListingsService } from './listings.service';

@Injectable()
export class ListingsFacade {
  constructor(
    private readonly listings: ListingRepository,
    private readonly listingsService: ListingsService,
  ) {}

  async isOwner(listingId: string, userId: string): Promise<boolean> {
    const listing = await this.listings.findOneBy({ id: listingId });
    return listing?.ownerId === userId;
  }

  async getSummary(listingId: string) {
    const listing = await this.listings.findOneBy({ id: listingId });
    if (!listing) throw new NotFoundException('Listing not found');
    return {
      id: listing.id,
      title: listing.title,
      status: listing.status,
      ownerId: listing.ownerId,
    };
  }

  findPublicByOwner(ownerId: string) {
    return this.listingsService.findPublicByOwner(ownerId);
  }

  async getSummaries(listingIds: string[]) {
    return this.listingsService.getSummaries(listingIds);
  }

  // ---- moderation passthroughs (admin dashboard) --------------------------
  // Routed through ListingsService so archive/restore keep their side effects
  // (outbox events driving the map-point projection, feed-cache clears).

  findById(listingId: string) {
    return this.listingsService.findById(listingId);
  }

  async archiveById(listingId: string) {
    return this.listingsService.archive(await this.mustGet(listingId));
  }

  async restoreById(listingId: string) {
    return this.listingsService.restore(await this.mustGet(listingId));
  }

  async updateById(
    listingId: string,
    dto: import('./dto/update-listing.dto').UpdateListingDto,
  ) {
    return this.listingsService.update(await this.mustGet(listingId), dto);
  }

  private async mustGet(listingId: string) {
    const listing = await this.listings.findOneBy({ id: listingId });
    if (!listing) throw new NotFoundException('Listing not found');
    return listing;
  }
}
