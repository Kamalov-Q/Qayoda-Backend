import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ListingRepository } from '../repositories/listing.repository';
import { ListingRequest } from '../types/listing-request.type';

@Injectable()
export class ListingOwnershipGuard implements CanActivate {
  constructor(private readonly listings: ListingRepository) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<ListingRequest>();
    const listingId: string = req.params.id;
    const userId: string | undefined = req.user?.sub;

    const listing = await this.listings.findOneBy({ id: listingId });
    // Checks the LISTING, not the id: `listingId` comes from the route and is
    // always set, so this branch never fired — a listing that did not exist
    // fell through to the ownership check and came back as 403 "not yours".
    if (!listing) throw new NotFoundException('Listing not found');
    if (!userId || listing.ownerId !== userId)
      throw new ForbiddenException('Not your listing');

    req.listing = listing;
    return true;
  }
}
