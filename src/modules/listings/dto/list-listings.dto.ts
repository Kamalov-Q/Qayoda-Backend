import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  Matches,
} from 'class-validator';
import { OfferPurpose } from '../enums/offer-purpose.enum';
import { CATEGORY_SLUG } from '../../categories/categories.constants';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** `GET /listings` — the browsable feed behind the list and grid views. */
export class ListListingsDto {
  @ApiProperty({ enum: OfferPurpose })
  @IsEnum(OfferPurpose)
  purpose: OfferPurpose;

  @ApiPropertyOptional({
    example: 'APARTMENT',
    description: 'A category slug (GET /categories). Omit to include every category.',
  })
  @IsOptional()
  @Matches(CATEGORY_SLUG)
  category?: string;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  priceMin?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  priceMax?: number;

  @ApiPropertyOptional({
    description: 'Matches the title and the address, case-insensitively.',
  })
  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(120)
  q?: string;

  @ApiPropertyOptional({
    example: 'Chilonzor',
    description:
      'Matches the address only, case-insensitively. The same filter the ' +
      'map takes, so switching between the two views keeps it.',
  })
  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(120)
  address?: string;

  @ApiPropertyOptional({ enum: ['newest', 'priceAsc', 'priceDesc'] })
  @IsOptional()
  @IsIn(['newest', 'priceAsc', 'priceDesc'])
  sort?: 'newest' | 'priceAsc' | 'priceDesc';

  @ApiPropertyOptional({ default: 20, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;

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
