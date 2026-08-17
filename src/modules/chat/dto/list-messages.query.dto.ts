import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ListMessagesQueryDto {
  @ApiPropertyOptional({
    minimum: 1,
    maximum: 100,
    default: 30,
    example: 30,
    description: 'Page size.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 30;

  /** Cursor: `createdAt` of the oldest loaded message. Must parse — an
   *  arbitrary string would reach Postgres as an invalid timestamp. */
  @ApiPropertyOptional({
    format: 'date-time',
    example: '2026-08-17T09:15:00.000Z',
    description:
      'Keyset cursor: pass the `createdAt` of the oldest message you already hold to fetch the page before it. Omit for the newest page.',
  })
  @IsOptional()
  @IsDateString()
  before?: string;
}
