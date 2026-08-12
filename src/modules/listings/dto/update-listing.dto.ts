import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateListingDto } from './create-listing.dto';

/**
 * Scalar fields only. Coordinates, offers and images each own a nested table or
 * a geography column that `Repository.update()` cannot write, so each is edited
 * through its own `PUT /listings/:id/...` endpoint.
 */
export class UpdateListingDto extends PartialType(
  OmitType(CreateListingDto, ['coordinates', 'offers', 'images'] as const),
) {}
