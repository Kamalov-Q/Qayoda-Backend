import { ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsOptional, ValidateNested } from 'class-validator';
import { CreateListingDto, OfferInputDto } from './create-listing.dto';

/**
 * Scalar fields + optional offers. Coordinates and images are edited through
 * their own dedicated endpoints or geometry updates.
 */
export class UpdateListingDto extends PartialType(
  OmitType(CreateListingDto, ['coordinates', 'offers', 'images'] as const),
) {
  @ApiPropertyOptional({
    type: [OfferInputDto],
    description: 'Replaces the listing offers if provided.',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OfferInputDto)
  offers?: OfferInputDto[];
}

