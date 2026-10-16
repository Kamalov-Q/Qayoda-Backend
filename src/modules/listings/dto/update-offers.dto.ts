import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { OfferInputDto } from './create-listing.dto';

export class UpdateOffersDto {
  @ApiProperty({
    type: [OfferInputDto],
    minItems: 1,
    description:
      'Replaces the listing\'s offers wholesale — any purpose missing from this array is removed.',
  })
  @IsArray()
  @ArrayMinSize(1)
  // Same rule as creation — this endpoint writes the same unique index.
  @ArrayUnique<OfferInputDto>((offer) => offer.purpose, {
    message: 'offers must have one entry per purpose',
  })
  @ValidateNested({ each: true })
  @Type(() => OfferInputDto)
  offers: OfferInputDto[];
}
