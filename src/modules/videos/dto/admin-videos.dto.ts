import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { VideoStatus } from '../videos.constants';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class AdminVideosQueryDto {
  @ApiPropertyOptional({ enum: VideoStatus })
  @IsOptional()
  @IsEnum(VideoStatus)
  status?: VideoStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  authorId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  listingId?: string;

  @ApiPropertyOptional({ description: 'Matches the caption.' })
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ minimum: 0, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

export class RemoveVideoDto {
  @ApiPropertyOptional({
    description:
      'Shown to nobody yet, kept for the record of the decision. Required in practice by whoever has to explain the takedown later.',
    maxLength: 255,
  })
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;
}
