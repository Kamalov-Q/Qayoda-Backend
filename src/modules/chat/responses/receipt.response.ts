import { ApiProperty } from '@nestjs/swagger';

export class ReadReceiptResponse {
  @ApiProperty({ format: 'uuid', example: '8c2a1b40-5f6d-4c3e-9a7b-1e0d5c4b3a29' })
  conversationId: string;

  @ApiProperty({
    format: 'date-time',
    description: 'When the sweep ran — every unread message got this timestamp.',
  })
  readAt: string;

  @ApiProperty({ format: 'uuid', description: 'Who read them (the caller).' })
  readBy: string;
}

export class DeletedMessageResponse {
  @ApiProperty({ format: 'uuid', example: '3f1c9d2e-8b4a-4a1e-9c7f-2d6b0e5a1f34' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  conversationId: string;

  @ApiProperty({ example: true })
  deleted: boolean;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  deletedBy: string | null;
}

export class PresenceResponse {
  @ApiProperty({ format: 'uuid' })
  userId: string;

  @ApiProperty({ example: false })
  online: boolean;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  lastSeenAt: string | null;
}
