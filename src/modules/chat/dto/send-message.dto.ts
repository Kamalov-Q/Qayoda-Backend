import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  IsInt,
  MaxLength,
  Min,
  IsArray,
  ArrayMaxSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MessageType } from '../enums/message-type.enum';

export class SendMessageDto {
  @ApiProperty({
    enum: MessageType,
    enumName: 'MessageType',
    example: MessageType.TEXT,
    description:
      '`TEXT` requires a non-empty `body`; every other type requires `mediaUrl`, and `VOICE`/`VIDEO_NOTE` additionally require `durationSec`.',
  })
  @IsEnum(MessageType)
  type: MessageType;

  @ApiPropertyOptional({
    maxLength: 4000,
    example: 'Assalomu alaykum, kvartira hali bandmi?',
    description: 'The text itself, or a caption alongside an attachment.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  body?: string;

  @ApiPropertyOptional({
    example: 'https://cdn.example.com/chat/2026-08/3f1c9d2e.jpg',
    description:
      'CDN URL returned by `POST /media/chat/upload`. Upload first, then send.',
  })
  @IsOptional()
  @IsString()
  mediaUrl?: string;

  @ApiPropertyOptional({
    example: 'https://cdn.example.com/chat/2026-08/3f1c9d2e_thumb.jpg',
  })
  @IsOptional()
  @IsString()
  thumbUrl?: string;

  @ApiPropertyOptional({ maxLength: 255, example: 'shartnoma.pdf' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  fileName?: string;

  @ApiPropertyOptional({ minimum: 0, example: 248130, description: 'Bytes.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  fileSize?: number;

  @ApiPropertyOptional({ maxLength: 128, example: 'image/jpeg' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  mimeType?: string;

  @ApiPropertyOptional({
    minimum: 0,
    example: 12,
    description: 'Required for `VOICE` and `VIDEO_NOTE`.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  durationSec?: number;

  @ApiPropertyOptional({ example: 1600 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  width?: number;

  @ApiPropertyOptional({ example: 1200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  height?: number;

  @ApiPropertyOptional({
    type: [Number],
    maxItems: 200,
    example: [4, 18, 55, 92, 71, 30, 12],
    description:
      '0-100 amplitude buckets for the voice waveform, as returned by the upload endpoint.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  waveform?: number[];

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Id of the message being replied to. Must belong to the same conversation.',
  })
  @IsOptional()
  @IsUUID()
  replyToId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Client-generated id for optimistic UI. Send it and a retry after a dropped connection returns the original message instead of creating a duplicate.',
  })
  @IsOptional()
  @IsUUID()
  clientId?: string;
}
