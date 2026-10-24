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
  ValidateNested,
} from 'class-validator';
import { VIDEO_COMMENT_MAX } from '../videos.constants';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** The photo half of a comment, as `POST /media/upload` returns it. */
export class VideoCommentImageDto {
  @ApiProperty()
  @IsString()
  url: string;

  @ApiProperty()
  @IsString()
  thumbUrl: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  width?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  height?: number;
}

export class CreateVideoCommentDto {
  @ApiPropertyOptional({
    maxLength: VIDEO_COMMENT_MAX,
    description: 'Optional when `image` is sent — a photo is a comment too.',
  })
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(VIDEO_COMMENT_MAX)
  body?: string;

  @ApiPropertyOptional({ type: VideoCommentImageDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => VideoCommentImageDto)
  image?: VideoCommentImageDto;

  @ApiPropertyOptional({
    description:
      'The top-level comment this replies to. Replying to a reply is refused — threads are one level deep.',
  })
  @IsOptional()
  @IsUUID()
  parentId?: string;
}

export class UpdateVideoCommentDto {
  @ApiProperty({ maxLength: VIDEO_COMMENT_MAX })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(VIDEO_COMMENT_MAX)
  body: string;
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
