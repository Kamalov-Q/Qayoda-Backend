import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsUUID,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export const SUPPORT_MAX_LENGTH = 2000;

/** A screenshot, as `POST /media/upload` returns it. */
export class SupportImageDto {
  @ApiProperty() @IsString() url: string;
  @ApiProperty() @IsString() thumbUrl: string;
}

export const SUPPORT_TYPES = [
  'TEXT',
  'IMAGE',
  'VIDEO',
  'VIDEO_NOTE',
  'VOICE',
  'FILE',
] as const;

export class SendSupportMessageDto {
  @ApiPropertyOptional({ enum: SUPPORT_TYPES, default: 'TEXT' })
  @IsOptional()
  @IsIn(SUPPORT_TYPES)
  type?: (typeof SUPPORT_TYPES)[number];

  @ApiPropertyOptional({ description: 'Attachment URL for non-image types.' })
  @IsOptional()
  @IsString()
  mediaUrl?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() thumbUrl?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() fileName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  fileSize?: number;

  @ApiPropertyOptional() @IsOptional() @IsString() mimeType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  durationSec?: number;

  @ApiPropertyOptional({ description: '0–100 amplitude bars for a voice note.' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  waveform?: number[];

  @ApiPropertyOptional({
    maxLength: SUPPORT_MAX_LENGTH,
    description: 'Optional when `image` is sent — a screenshot is a message.',
  })
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(SUPPORT_MAX_LENGTH)
  body?: string;

  @ApiPropertyOptional({ description: 'A message in this thread to answer.' })
  @IsOptional()
  @IsUUID()
  replyToId?: string;

  @ApiPropertyOptional({ type: SupportImageDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => SupportImageDto)
  image?: SupportImageDto;
}

export class ForwardToSupportDto {
  @ApiProperty({ description: 'A message from one of your conversations.' })
  @IsUUID()
  messageId: string;
}

export class SupportQueryDto {
  @ApiPropertyOptional({ enum: ['OPEN', 'CLOSED'] })
  @IsOptional()
  @IsIn(['OPEN', 'CLOSED'])
  status?: 'OPEN' | 'CLOSED';

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

export class PinSupportDto {
  @ApiPropertyOptional({ description: 'Omit or send null to clear the pin.' })
  @IsOptional()
  @IsUUID()
  messageId?: string | null;
}

export class SupportStatusDto {
  @ApiProperty({ enum: ['OPEN', 'CLOSED'] })
  @IsIn(['OPEN', 'CLOSED'])
  status: 'OPEN' | 'CLOSED';
}
