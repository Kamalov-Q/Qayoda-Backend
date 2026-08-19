import { ApiProperty } from '@nestjs/swagger';
import { MessageResponse } from './message.response';

/** The other participant, with presence folded in. */
export class CounterpartResponse {
  @ApiProperty({
    format: 'uuid',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  id: string;

  @ApiProperty({ type: String, nullable: true, example: 'Ada' })
  name?: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'Lovelace' })
  surname?: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'https://cdn.example.com/avatar/3f1c9d2e.jpg',
  })
  avatarThumbUrl?: string | null;

  @ApiProperty({
    nullable: true,
    example: '+998901234567',
    description: 'Denormalised phone number.',
  })
  phoneNumber?: string | null;

  @ApiProperty({
    example: true,
    description:
      'Whether they currently hold a socket on the `/chat` namespace.',
  })
  online: boolean;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'Last disconnect. Meaningless while `online` is true.',
  })
  lastSeenAt: string | null;
}

export class ConversationResponse {
  @ApiProperty({
    format: 'uuid',
    example: '8c2a1b40-5f6d-4c3e-9a7b-1e0d5c4b3a29',
  })
  id: string;

  @ApiProperty({
    format: 'uuid',
    example: '3f1c9d2e-8b4a-4a1e-9c7f-2d6b0e5a1f34',
  })
  listingId: string;

  @ApiProperty({
    enum: ['host', 'guest'],
    example: 'guest',
    description:
      "The caller's side of this conversation — `host` owns the listing, `guest` enquired about it.",
  })
  role: 'host' | 'guest';

  @ApiProperty({ type: CounterpartResponse })
  other: CounterpartResponse;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  lastMessageAt: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    maxLength: 160,
    example: '📷 Rasm',
    description: 'Denormalised preview for the conversation list.',
  })
  lastMessagePreview: string | null;
}

export class ConversationListItemResponse extends ConversationResponse {
  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Chilonzorda 3 xonali kvartira',
  })
  listingTitle: string | null;

  @ApiProperty({
    example: 3,
    description: 'Messages from the counterpart that the caller has not read.',
  })
  unreadCount: number;
}

export class StartConversationResponse {
  @ApiProperty({ type: ConversationResponse })
  conversation: ConversationResponse;

  @ApiProperty({
    type: MessageResponse,
    description: 'The opening message, already persisted.',
  })
  message: MessageResponse;
}
