import { ApiProperty } from '@nestjs/swagger';
import { MessageStatus } from '../enums/message-status.enum';
import { MessageType } from '../enums/message-type.enum';

const UUID = '3f1c9d2e-8b4a-4a1e-9c7f-2d6b0e5a1f34';

export class MessageResponse {
  @ApiProperty({ format: 'uuid', example: UUID })
  id: string;

  @ApiProperty({ format: 'uuid', example: '8c2a1b40-5f6d-4c3e-9a7b-1e0d5c4b3a29' })
  conversationId: string;

  @ApiProperty({ format: 'uuid', example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })
  senderId: string;

  @ApiProperty({
    enum: MessageType,
    enumName: 'MessageType',
    example: MessageType.TEXT,
  })
  type: MessageType;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Assalomu alaykum, kvartira hali bandmi?',
    description:
      'Text body, or the caption on a media message. Always `null` once the message is deleted.',
  })
  body: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'https://cdn.example.com/chat/2026-08/3f1c9d2e.jpg',
    description: 'CDN URL of the attachment. `null` for `TEXT`.',
  })
  mediaUrl: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'https://cdn.example.com/chat/2026-08/3f1c9d2e_thumb.jpg',
    description: 'Poster frame for video, thumbnail for images.',
  })
  thumbUrl: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'shartnoma.pdf' })
  fileName: string | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 248130,
    description: 'Attachment size in bytes.',
  })
  fileSize: number | null;

  @ApiProperty({ type: String, nullable: true, example: 'image/jpeg' })
  mimeType: string | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 12,
    description: 'Duration in seconds. Set for `VOICE` and `VIDEO_NOTE`.',
  })
  durationSec: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 1600 })
  width: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 1200 })
  height: number | null;

  @ApiProperty({
    type: [Number],
    nullable: true,
    example: [4, 18, 55, 92, 71, 30, 12],
    description:
      '0-100 amplitude buckets for the voice-note waveform UI (60 buckets).',
  })
  waveform: number[] | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'Id of the message this one replies to.',
  })
  replyToId: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  editedAt: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  editedBy: string | null;

  @ApiProperty({ example: 0, description: 'How many times the body was edited.' })
  editCount: number;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description:
      'Set on a soft delete. The row survives so reply chains stay intact, but its body and media are cleared.',
  })
  deletedAt: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  deletedBy: string | null;

  @ApiProperty({
    enum: MessageStatus,
    enumName: 'MessageStatus',
    example: MessageStatus.SENT,
    description:
      '`SENT` on write, `DELIVERED` once the recipient has a live socket, `READ` after they open the conversation.',
  })
  status: MessageStatus;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  deliveredAt: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  readAt: string | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description:
      'Echoed back so the client can reconcile its optimistic bubble. Resending the same `clientId` returns the original message instead of a duplicate.',
  })
  clientId: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;
}

export class ReplyPreviewResponse {
  @ApiProperty({ format: 'uuid', example: UUID })
  id: string;

  @ApiProperty({ format: 'uuid' })
  senderId: string;

  @ApiProperty({ enum: MessageType, enumName: 'MessageType' })
  type: MessageType;

  @ApiProperty({
    example: 'Assalomu alaykum, kvartira hali bandmi?',
    description:
      'First 160 characters for text, or an icon label for media. Reads `Deleted message` once the target is gone.',
  })
  preview: string;
}

export class MessageWithReplyResponse extends MessageResponse {
  @ApiProperty({
    type: ReplyPreviewResponse,
    nullable: true,
    description:
      'Inlined so a reply renders without a second round-trip. `null` when the message is not a reply, or the target has been hard-deleted.',
  })
  replyTo: ReplyPreviewResponse | null;
}
