import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateListingDto } from './create-listing.dto';

export class UpdateListingDto extends PartialType(
  OmitType(CreateListingDto, ['coordinates', 'offers'] as const),
) {}
