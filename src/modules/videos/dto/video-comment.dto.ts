import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { VIDEO_COMMENT_MAX } from '../videos.constants';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateVideoCommentDto {
  @ApiProperty({ maxLength: VIDEO_COMMENT_MAX })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(VIDEO_COMMENT_MAX)
  body: string;

  @ApiPropertyOptional({
    description:
      'The top-level comment this replies to. Replying to a reply is refused — threads are one level deep.',
  })
  @IsOptional()
  @IsUUID()
  parentId?: string;
}

export class VideoCommentsQueryDto {
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
