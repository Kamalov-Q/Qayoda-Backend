import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { STORY_HOURS, STORY_TYPES, type StoryType } from '../story.entity';
import {
  STORY_REPORT_REASONS,
  type StoryReportReason,
} from '../../reports/reports.constants';

/** Long enough for a paragraph over a photo, short enough to stay a story. */
export const STORY_BODY_MAX = 600;

/** How many background colours the app offers for a text story. */
export const STORY_BACKGROUNDS = 6;

export class CreateStoryDto {
  @ApiProperty({
    enum: STORY_TYPES,
    description:
      'IMAGE and VIDEO need `mediaUrl`; TEXT needs `body`. A caption may ' +
      'ride on any of them.',
  })
  @IsEnum(STORY_TYPES)
  type: StoryType;

  @ApiPropertyOptional({
    description: 'From POST /media/stories/upload. Required unless TEXT.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  mediaUrl?: string;

  @ApiPropertyOptional({ description: 'Poster frame / tray thumbnail.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  thumbUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  width?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  height?: number;

  @ApiPropertyOptional({ description: 'Videos only, seconds.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(600)
  durationSec?: number;

  @ApiPropertyOptional({
    maxLength: STORY_BODY_MAX,
    description: 'The caption, or the whole story when the type is TEXT.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(STORY_BODY_MAX)
  body?: string;

  @ApiPropertyOptional({
    minimum: 0,
    maximum: STORY_BACKGROUNDS - 1,
    description: "Palette index for a text story's background.",
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(STORY_BACKGROUNDS - 1)
  background?: number;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'A listing to send viewers to. Must be one of yours and live — a ' +
      'story is not a way to advertise somebody else’s advert.',
  })
  @IsOptional()
  @IsUUID()
  listingId?: string;

  @ApiPropertyOptional({
    enum: STORY_HOURS,
    default: 24,
    description: 'How long it stays up. Telegram’s four choices.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsIn([...STORY_HOURS])
  hours?: number;
}

export class ReactToStoryDto {
  @ApiProperty({
    example: '❤️',
    description: 'One emoji. Send the same one again to take it back.',
  })
  @IsString()
  @MaxLength(16)
  emoji: string;
}

export class ForwardStoryDto {
  @ApiProperty({
    description:
      'A conversation the sender is already in. The story arrives as a ' +
      'message attributed to whoever posted it.',
  })
  @IsUUID()
  conversationId: string;
}

export class ReportStoryDto {
  @ApiProperty({
    enum: STORY_REPORT_REASONS,
    description: 'Why. OTHER requires `comment`.',
  })
  @IsEnum(STORY_REPORT_REASONS)
  reason: StoryReportReason;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}

export class AdminStoryReportsQueryDto {
  @ApiPropertyOptional({ enum: ['OPEN', 'RESOLVED', 'DISMISSED'] })
  @IsOptional()
  @IsIn(['OPEN', 'RESOLVED', 'DISMISSED'])
  status?: 'OPEN' | 'RESOLVED' | 'DISMISSED';

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
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

export class AdminStoryReportStatusDto {
  @ApiProperty({ enum: ['OPEN', 'RESOLVED', 'DISMISSED'] })
  @IsIn(['OPEN', 'RESOLVED', 'DISMISSED'])
  status: 'OPEN' | 'RESOLVED' | 'DISMISSED';
}

export class StoryViewersQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 50 })
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
