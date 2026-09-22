import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { AMENITY_KEY } from '../amenities.constants';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateAmenityDto {
  @ApiProperty({
    example: 'FIREPLACE',
    description:
      'Upper-snake key, stored on every listing that picks this amenity. Cannot be changed later.',
  })
  // Accept "fireplace" or "Smart home" and store FIREPLACE / SMART_HOME.
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? value.trim().toUpperCase().replace(/[\s-]+/g, '_')
      : value,
  )
  @Matches(AMENITY_KEY, {
    message: 'key: A–Z, 0–9 and _ only, starting with a letter (2–40 chars)',
  })
  key: string;

  @ApiProperty({ example: 'Kamin', maxLength: 60 })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  nameUz: string;

  @ApiProperty({ example: 'Камин', maxLength: 60 })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  nameRu: string;

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
}

/** Everything but the key, which listings depend on. */
export class UpdateAmenityDto extends PartialType(
  OmitType(CreateAmenityDto, ['key'] as const),
) {}
