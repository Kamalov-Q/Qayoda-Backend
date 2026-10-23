import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  VIDEO_REPORT_REASONS,
  VIDEO_REPORT_STATUSES,
  type VideoReportReason,
  type VideoReportStatus,
} from '../videos.constants';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateVideoReportDto {
  @ApiProperty({ enum: VIDEO_REPORT_REASONS })
  @IsIn(VIDEO_REPORT_REASONS)
  reason: VideoReportReason;

  @ApiPropertyOptional({
    maxLength: 1000,
    description:
      'Required when the reason is OTHER — it tells the moderator nothing on its own.',
  })
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}

export class AdminVideoReportsQueryDto {
  @ApiPropertyOptional({ enum: VIDEO_REPORT_STATUSES })
  @IsOptional()
  @IsIn(VIDEO_REPORT_STATUSES)
  status?: VideoReportStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  videoId?: string;

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

export class ResolveVideoReportDto {
  @ApiProperty({ enum: ['RESOLVED', 'DISMISSED'] })
  @IsIn(['RESOLVED', 'DISMISSED'])
  status: 'RESOLVED' | 'DISMISSED';

  @ApiPropertyOptional({
    maxLength: 255,
    description: 'Kept on the row as the record of the decision.',
  })
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(255)
  note?: string;

  @ApiPropertyOptional({
    description:
      'Take the video down as part of resolving. Does the same thing as DELETE /admin/videos/:id, in one step, which is what a moderator looking at an upheld report actually wants.',
  })
  @IsOptional()
  removeVideo?: boolean;
}
