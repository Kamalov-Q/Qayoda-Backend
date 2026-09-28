import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { OfferPurpose } from '../../listings/enums/offer-purpose.enum';

/** How a profile's listings may be ordered. */
export enum OwnerListingSortDto {
  NEWEST = 'newest',
  OLDEST = 'oldest',
  PRICE_ASC = 'priceAsc',
  PRICE_DESC = 'priceDesc',
}

/** Paging and filtering for GET /users/:id/listings. */
export class OwnerListingsQueryDto {
  @ApiPropertyOptional({
    enum: OfferPurpose,
    description:
      'Only listings carrying a live offer of this purpose. Counts per ' +
      'purpose come with the profile, under `facets`.',
  })
  @IsOptional()
  @IsEnum(OfferPurpose)
  purpose?: OfferPurpose;

  @ApiPropertyOptional({
    example: 'APARTMENT',
    description: 'Category slug. Counts per category also come with `facets`.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  category?: string;

  @ApiPropertyOptional({
    enum: OwnerListingSortDto,
    default: OwnerListingSortDto.NEWEST,
    description:
      'Price sorts use the lowest live offer on each listing, in USD; ' +
      'listings with no comparable price sort last.',
  })
  @IsOptional()
  @IsEnum(OwnerListingSortDto)
  sort?: OwnerListingSortDto;

  @ApiPropertyOptional({ minimum: 1, maximum: 50, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @ApiPropertyOptional({ minimum: 0, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
