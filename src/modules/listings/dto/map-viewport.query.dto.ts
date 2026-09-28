import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  Matches,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OfferPurpose } from '../enums/offer-purpose.enum';
import { CATEGORY_SLUG } from '../../categories/categories.constants';
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
    example: 'APARTMENT',
    description: 'A category slug (GET /categories). Omit to include every category.',
  })
  @IsOptional()
  @Matches(CATEGORY_SLUG)
  category?: string;

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

  @ApiPropertyOptional({
    example: 'Chilonzor',
    maxLength: 120,
    description:
      'Case-insensitive substring match against the listing address. Omit (or send blank) to skip.',
  })
  @IsOptional()
  // Blank after trimming means "not filtering", same as omitting the param —
  // a bare `address=` in the query string must not silently exclude every
  // listing whose address is NULL.
  @Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
  })
  @IsString()
  @MaxLength(120)
  address?: string;

  @ApiPropertyOptional({
    example: 'Chilonzor',
    description:
      'Free search over the title AND the address — what the search box on ' +
      'the sale tab sends. Narrows alongside `address`, which matches the ' +
      'address only.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @ApiPropertyOptional({
    example: 69.24,
    description:
      'Centre of a radius filter, with `centerLat` and `radiusM`. All three ' +
      'are needed; any one alone is ignored.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  centerLng?: number;

  @ApiPropertyOptional({ example: 41.31 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  centerLat?: number;

  @ApiPropertyOptional({
    example: 1500,
    minimum: 100,
    maximum: 100000,
    description:
      'Radius in metres. Measured from the centroid, so a plot is in or out ' +
      'by its middle rather than by whichever corner is nearest.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(100)
  @Max(100_000)
  radiusM?: number;

}
