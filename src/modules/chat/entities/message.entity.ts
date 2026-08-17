import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { Conversation } from './conversation.entity';
import { MessageType } from '../enums/message-type.enum';
import { MessageStatus } from '../enums/message-status.enum';

@Entity('messages')
// Paging: WHERE conversation_id = ? ORDER BY created_at DESC LIMIT n
@Index('idx_messages_conv_created', ['conversationId', 'createdAt'])
// Unread counts / read sweeps — partial index stays tiny
@Index('idx_messages_conv_sender_unread', ['conversationId', 'senderId'], {
  where: '"read_at" IS NULL AND "deleted_at" IS NULL',
})
export class Message {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column({ name: 'conversation_id' }) conversationId: string;

  @ManyToOne(() => Conversation, (c) => c.messages, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'conversation_id' })
  conversation: Conversation;

  @Column({ name: 'sender_id' }) senderId: string;

  @Column({ type: 'enum', enum: MessageType, default: MessageType.TEXT })
  type: MessageType;

  /** Text body, or caption on a media message */
  @Column({ type: 'text', nullable: true }) body: string | null;

  // ---- attachment (null for TEXT) ----
  @Column({ name: 'media_url', type: 'text', nullable: true }) mediaUrl:
    string | null;
  @Column({ name: 'thumb_url', type: 'text', nullable: true }) thumbUrl:
    string | null;
  @Column({ name: 'file_name', type: 'varchar', length: 255, nullable: true })
  fileName: string | null;
  @Column({ name: 'file_size', type: 'bigint', nullable: true }) fileSize:
    string | null;
  @Column({ name: 'mime_type', type: 'varchar', length: 128, nullable: true })
  mimeType: string | null;
  @Column({ name: 'duration_sec', type: 'int', nullable: true }) durationSec:
    number | null;
  @Column({ type: 'int', nullable: true }) width: number | null;
  @Column({ type: 'int', nullable: true }) height: number | null;
  /** 0-100 amplitude bars for the voice waveform UI */
  @Column({ type: 'jsonb', nullable: true }) waveform: number[] | null;

  @Column({ name: 'reply_to_id', type: 'varchar', nullable: true })
  replyToId: string | null;

  // ---- edit audit: who, when, how many times, what it said before ----
  @Column({ name: 'edited_at', type: 'timestamptz', nullable: true })
  editedAt: Date | null;
  @Column({ name: 'edited_by', type: 'varchar', nullable: true })
  editedBy: string | null;
  @Column({ name: 'edit_count', type: 'int', default: 0 }) editCount: number;
  @Column({ name: 'previous_body', type: 'text', nullable: true })
  previousBody: string | null;

  // ---- soft delete audit ----
  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
  @Column({ name: 'deleted_by', type: 'varchar', nullable: true })
  deletedBy: string | null;

  // ---- delivery ----
  @Column({ type: 'enum', enum: MessageStatus, default: MessageStatus.SENT })
  status: MessageStatus;

  @Column({ name: 'delivered_at', type: 'timestamptz', nullable: true })
  deliveredAt: Date | null;
  @Column({ name: 'read_at', type: 'timestamptz', nullable: true })
  readAt: Date | null;

  /** Client-generated id: optimistic UI + retry dedupe */
  @Index()
  @Column({ name: 'client_id', type: 'varchar', nullable: true })
  clientId: string | null;

  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
}
