import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { CATEGORY_ICON_KEYS, CATEGORY_SLUG } from '../categories.constants';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateCategoryDto {
  @ApiProperty({
    example: 'OFFICE',
    description:
      'Upper-snake key, stored on every listing in this category. Cannot be changed later.',
  })
  // Accept "office" or "Office space" and store OFFICE / OFFICE_SPACE.
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? value.trim().toUpperCase().replace(/[\s-]+/g, '_')
      : value,
  )
  @Matches(CATEGORY_SLUG, {
    message: 'slug: A–Z, 0–9 and _ only, starting with a letter (2–40 chars)',
  })
  slug: string;

  @ApiProperty({ example: 'Ofis', maxLength: 60 })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  nameUz: string;

  @ApiProperty({ example: 'Офис', maxLength: 60 })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  nameRu: string;

  @ApiProperty({ enum: CATEGORY_ICON_KEYS, example: 'office' })
  @IsIn(CATEGORY_ICON_KEYS)
  icon: string;

  @ApiPropertyOptional({ default: 0, description: 'Lower comes first.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000)
  sortOrder?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    default: false,
    description: 'Whether listings in it may have floor / total floors.',
  })
  @IsOptional()
  @IsBoolean()
  floorCapable?: boolean;
}

/** Everything but the slug, which listings depend on. */
export class UpdateCategoryDto extends PartialType(
  OmitType(CreateCategoryDto, ['slug'] as const),
) {}

export class DeleteCategoryQueryDto {
  @ApiPropertyOptional({
    example: 'HOUSE',
    description:
      'Move this category’s listings here first. Required when any listing uses it.',
  })
  @IsOptional()
  @Matches(CATEGORY_SLUG)
  moveTo?: string;
}
