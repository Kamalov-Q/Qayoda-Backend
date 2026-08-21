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
}
