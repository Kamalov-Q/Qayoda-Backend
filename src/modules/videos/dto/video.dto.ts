import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  VIDEO_CAPTION_MAX,
  VIDEO_FEED_MAX,
  VIEW_BATCH_MAX,
} from '../videos.constants';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateUploadTicketDto {
  @ApiPropertyOptional({
    description:
      'The listing this clip advertises. Must be yours. A video with one gets the "open the listing" button in the feed and a head start in the ranking.',
  })
  @IsOptional()
  @IsUUID()
  listingId?: string;

  @ApiPropertyOptional({ maxLength: VIDEO_CAPTION_MAX })
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(VIDEO_CAPTION_MAX)
  caption?: string;

  @ApiPropertyOptional({
    description:
      "The file's MIME type, passed to Bunny as tus metadata. Informational: the duration check runs on the encoded file, whatever the phone says here.",
    example: 'video/mp4',
  })
  @IsOptional()
  @IsString()
  @Matches(/^video\/[a-zA-Z0-9.+-]{1,32}$/, {
    message: 'mimeType must be a video/* type',
  })
  mimeType?: string;
}

export class UpdateVideoDto {
  @ApiPropertyOptional({ maxLength: VIDEO_CAPTION_MAX })
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(VIDEO_CAPTION_MAX)
  caption?: string;

  @ApiPropertyOptional({
    description:
      'Point the clip at one of your listings, or send null to unlink it. Changing this does not re-rank a video that is already published.',
    nullable: true,
  })
  @IsOptional()
  @IsUUID()
  listingId?: string | null;
}

export class VideoFeedQueryDto {
  @ApiPropertyOptional({
    enum: ['foryou', 'following'],
    default: 'foryou',
    description:
      '`following` narrows the feed to the people you follow. Empty for a caller with no session — there is nobody to follow yet.',
  })
  @IsOptional()
  @IsIn(['foryou', 'following'])
  scope?: 'foryou' | 'following';

  @ApiPropertyOptional({ minimum: 1, maximum: VIDEO_FEED_MAX })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(VIDEO_FEED_MAX)
  limit?: number;

  @ApiPropertyOptional({
    description:
      'Opaque: hand back the `nextCursor` of the previous page. Keyset, not offset — a feed people post into all day shifts under an offset, which is how the same reel appears twice.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  cursor?: string;
}

export class MyVideosQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

export class ReportedViewDto {
  @ApiProperty()
  @IsUUID()
  videoId: string;

  @ApiProperty({
    description:
      'How long this viewer watched, in milliseconds. Under VIEW_MIN_WATCH_MS the view is dropped: a swipe past is not a view.',
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(24 * 60 * 60 * 1000)
  watchedMs: number;
}

export class ReportViewsDto {
  @ApiProperty({
    type: [ReportedViewDto],
    maxItems: VIEW_BATCH_MAX,
    description:
      'Sent in batches every few seconds, not one request per reel — a fast scroller would otherwise fire a request per swipe.',
  })
  @IsArray()
  @ArrayMaxSize(VIEW_BATCH_MAX)
  @ValidateNested({ each: true })
  @Type(() => ReportedViewDto)
  views: ReportedViewDto[];
}
