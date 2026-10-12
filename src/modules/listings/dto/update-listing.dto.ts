import { ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsOptional, ValidateNested } from 'class-validator';
import { CreateListingDto, OfferInputDto } from './create-listing.dto';
import { ApiPolygonCoordinates } from '../decorators/api-polygon-coordinates.decorator';
import { ValidPolygon } from '../validators/valid-polygon.validator';
import type { PolygonCoordinates } from '../types/geojson.type';

/**
 * Scalar fields + optional offers and coordinates.
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

  @ApiPolygonCoordinates()
  @IsOptional()
  @ValidPolygon({ message: 'Invalid property outline' })
  coordinates?: PolygonCoordinates;
}

