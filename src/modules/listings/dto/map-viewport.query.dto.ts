import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OfferPurpose } from '../enums/offer-purpose.enum';
import { PropertyCategory } from '../enums/property-category.enum';
import { POLYGON_ZOOM_THRESHOLD } from '../listings.constants';

export class MapViewportQueryDto {
  @ApiProperty({
    example: 69.1,
    description: 'Western edge of the viewport, in degrees longitude.',
  })
  @Type(() => Number)
  @IsNumber()
  west: number;

  @ApiProperty({
    example: 41.25,
    description: 'Southern edge of the viewport, in degrees latitude.',
  })
  @Type(() => Number)
  @IsNumber()
  south: number;

  @ApiProperty({
    example: 69.35,
    description: 'Eastern edge of the viewport, in degrees longitude.',
  })
  @Type(() => Number)
  @IsNumber()
  east: number;

  @ApiProperty({
    example: 41.36,
    description: 'Northern edge of the viewport, in degrees latitude.',
  })
  @Type(() => Number)
  @IsNumber()
  north: number;

  @ApiProperty({
    type: 'integer',
    example: 14,
    minimum: 1,
    maximum: 22,
    description: `Current map zoom level. It selects the response shape: below ${POLYGON_ZOOM_THRESHOLD} the endpoint returns clustered points, at ${POLYGON_ZOOM_THRESHOLD} and above it returns full outlines.`,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(22)
  zoom: number;

  @ApiProperty({
    enum: OfferPurpose,
    enumName: 'OfferPurpose',
    example: OfferPurpose.SALE,
    description:
      'Only listings carrying an active offer for this purpose are returned, and the price shown is that offer’s.',
  })
  @IsEnum(OfferPurpose)
  purpose: OfferPurpose;

  @ApiPropertyOptional({
    enum: PropertyCategory,
    enumName: 'PropertyCategory',
    example: PropertyCategory.APARTMENT,
    description: 'Omit to include every category.',
  })
  @IsOptional()
  @IsEnum(PropertyCategory)
  category?: PropertyCategory;

  @ApiPropertyOptional({
    example: 500000000,
    minimum: 0,
    description: 'Lower price bound, in the offer’s own currency.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  priceMin?: number;

  @ApiPropertyOptional({
    example: 1200000000,
    minimum: 0,
    description: 'Upper price bound, in the offer’s own currency.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  priceMax?: number;
}
