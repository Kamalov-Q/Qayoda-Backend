import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { REPORT_REASONS, REPORT_STATUSES } from '../reports.constants';
import type { ReportReason } from '../reports.constants';
import type { ReportStatus } from '../report.entity';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateReportDto {
  @ApiProperty({ enum: REPORT_REASONS, example: 'FRAUD' })
  @IsIn(REPORT_REASONS)
  reason: ReportReason;

  @ApiPropertyOptional({
    maxLength: 500,
    description: 'Required when reason is OTHER, optional otherwise.',
  })
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}

export class AdminReportsQueryDto {
  @ApiPropertyOptional({ enum: REPORT_STATUSES })
  @IsOptional()
  @IsIn(REPORT_STATUSES)
  status?: ReportStatus;

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

export class AdminReportStatusDto {
  @ApiProperty({ enum: REPORT_STATUSES })
  @IsIn(REPORT_STATUSES)
  status: ReportStatus;
}
