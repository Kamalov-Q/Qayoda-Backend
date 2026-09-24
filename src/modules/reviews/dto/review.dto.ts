import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** The most text a review may carry. Long enough for a real account of a
 *  viewing, short enough that the card stays a card. */
export const REVIEW_MAX_LENGTH = 1000;

export class UpsertReviewDto {
  @ApiProperty({ minimum: 1, maximum: 5, example: 5 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @ApiPropertyOptional({
    maxLength: REVIEW_MAX_LENGTH,
    description: 'Optional — a rating on its own is a complete review.',
  })
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(REVIEW_MAX_LENGTH)
  comment?: string;
}

export class ReviewsQueryDto {
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

export class AdminReviewsQueryDto extends ReviewsQueryDto {
  @ApiPropertyOptional({
    description: 'Only reviews at or below this rating — the complaints.',
    minimum: 1,
    maximum: 5,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  maxRating?: number;

  @ApiPropertyOptional({ description: 'Only reviews that carry text.' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  withText?: boolean;
}
