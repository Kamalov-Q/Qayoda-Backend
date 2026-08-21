import { Injectable } from '@nestjs/common';
import { IamFacade } from '../iam/iam.facade';
import { ListingsFacade } from '../listings/listings.facade';

@Injectable()
export class UsersService {
  constructor(
    private readonly iam: IamFacade,
    private readonly listings: ListingsFacade,
  ) {}

  /** Everything the profile screen shows in one call: who they are, and their ads. */
  async getProfileWithListings(userId: string) {
    // The card 404s on an unknown id, so the listings query is only ever run
    // for a user that exists — but both are in flight before that is known,
    // which costs nothing on the miss and saves a round trip on the hit.
    const [user, listings] = await Promise.all([
      this.iam.getUserCard(userId),
      this.listings.findPublicByOwner(userId),
    ]);

    return { ...user, listings, listingCount: listings.length };
  }
}
