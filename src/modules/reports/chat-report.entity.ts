import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import type { ReportStatus } from './report.entity';

/**
 * A participant flagging a conversation for the moderators.
 *
 * This row is also the ACCESS TOKEN to that conversation: admins have no way
 * to list or open chats, and the only endpoint that returns messages takes a
 * report id. No report, no reading — see ChatReportsService.adminGet.
 *
 * One row per (conversation, reporter), like listing reports, so counts mean
 * "how many people", not "how many taps".
 */
@Entity('chat_reports')
@Unique('uq_chat_report_conversation_reporter', ['conversationId', 'reporterId'])
export class ChatReport {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Index() @Column({ name: 'conversation_id', type: 'uuid' }) conversationId: string;
  @Index() @Column({ name: 'reporter_id', type: 'uuid' }) reporterId: string;

  /**
   * The message that prompted it, when the report came from one. Kept as
   * context for the moderator; the transcript is shown either way.
   */
  @Column({ name: 'message_id', type: 'uuid', nullable: true })
  messageId: string | null;

  /** One of CHAT_REPORT_REASONS — fixed keys, labels live client-side. */
  @Column({ type: 'varchar', length: 40 }) reason: string;

  /** Free text; required when the reason is OTHER, optional otherwise. */
  @Column({ type: 'text', nullable: true }) comment: string | null;

  @Index()
  @Column({ type: 'varchar', length: 20, default: 'OPEN' })
  status: ReportStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}
