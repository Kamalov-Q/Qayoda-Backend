import type { AuthenticatedRequest } from 'src/modules/auth/types/auth-user.type';
import type { Listing } from '../entities/listing.entity';

/**
 * Request that passed ListingOwnershipGuard, which resolves the `:id` route
 * param and attaches the loaded listing.
 */
export interface ListingRequest extends AuthenticatedRequest<{ id: string }> {
  listing: Listing;
}
