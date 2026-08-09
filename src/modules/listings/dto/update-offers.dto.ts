import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, ValidateNested } from 'class-validator';
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
  @ValidateNested({ each: true })
  @Type(() => OfferInputDto)
  offers: OfferInputDto[];
}
