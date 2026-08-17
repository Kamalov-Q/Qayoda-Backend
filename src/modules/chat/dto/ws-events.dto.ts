import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SendMessageDto } from './send-message.dto';

const CONVERSATION_ID = {
  format: 'uuid',
  example: '8c2a1b40-5f6d-4c3e-9a7b-1e0d5c4b3a29',
};

const MESSAGE_ID = {
  format: 'uuid',
  example: '3f1c9d2e-8b4a-4a1e-9c7f-2d6b0e5a1f34',
};

/**
 * Socket payloads need a real class: an intersection type such as
 * `{ conversationId: string } & SendMessageDto` erases to `Object` at runtime,
 * and ValidationPipe skips `Object` — so nothing would actually be validated.
 *
 * These are documented in the OpenAPI components via `extraModels` in main.ts;
 * OpenAPI itself cannot describe socket events, so the narrative lives in the
 * "Realtime" section of the API description.
 */
export class WsSendMessageDto extends SendMessageDto {
  @ApiProperty(CONVERSATION_ID)
  @IsUUID()
  conversationId: string;
}

export class WsConversationDto {
  @ApiProperty(CONVERSATION_ID)
  @IsUUID()
  conversationId: string;
}

export class WsMessageIdDto {
  @ApiProperty(MESSAGE_ID)
  @IsUUID()
  messageId: string;
}

export class WsEditMessageDto {
  @ApiProperty(MESSAGE_ID)
  @IsUUID()
  messageId: string;

  @ApiProperty({ minLength: 1, maxLength: 4000, example: 'Tuzatilgan matn' })
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  body: string;
}

export class WsTypingDto {
  @ApiProperty(CONVERSATION_ID)
  @IsUUID()
  conversationId: string;

  @ApiProperty({
    example: true,
    description: 'Emit `true` on keystroke and `false` when the composer clears.',
  })
  @IsBoolean()
  isTyping: boolean;

  @ApiPropertyOptional({
    enum: ['text', 'voice', 'video'],
    default: 'text',
    description: 'Lets the peer show "recording voice…" rather than "typing…".',
  })
  @IsOptional()
  @IsIn(['text', 'voice', 'video'])
  kind?: 'text' | 'voice' | 'video';
}

export class WsPresenceCheckDto {
  @ApiProperty({
    type: [String],
    format: 'uuid',
    maxItems: 200,
    description: 'Users to look up, typically the counterparts on screen.',
  })
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true })
  userIds: string[];
}
