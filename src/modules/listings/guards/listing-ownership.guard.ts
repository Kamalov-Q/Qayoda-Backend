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
    const userId: string | undefined = req.user?.userId;

    const listing = await this.listings.findOneBy({ id: listingId });
    if (!listingId) throw new NotFoundException('Listing not found');
    if (!userId || listing?.ownerId !== userId)
      throw new ForbiddenException('Not your listing');
    

    req.listing = listing;
    return true;
  }
}
