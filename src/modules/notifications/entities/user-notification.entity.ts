import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { NotificationKind } from '../notifications.constants';

/**
 * One thing worth telling somebody about.
 *
 * Rows, not pushes. There is no push infrastructure in this app — no device
 * tokens, no APNs/FCM credentials — so this is an inbox the client reads,
 * which is the half that has to exist first anyway: a push nobody can open
 * afterwards is a notification that happened to you rather than for you.
 *
 * Targets are nullable columns rather than a `data` blob. A blob would take
 * five minutes less to write and would then be the thing nobody can query
 * when the question is "how many people were told about this video".
 */
@Entity('user_notifications')
@Index('IDX_notifications_user', ['userId', 'createdAt'])
@Index('IDX_notifications_unread', ['userId'], { where: 'read_at IS NULL' })
export class UserNotification {
  @PrimaryGeneratedColumn('uuid') id: string;

  /** Who is being told. */
  @Column({ name: 'user_id', type: 'uuid' }) userId: string;

  @Column({ type: 'varchar', length: 32 }) kind: NotificationKind;

  /** Who did it. Null when the platform is the actor (a video going live). */
  @Column({ name: 'actor_id', type: 'uuid', nullable: true })
  actorId: string | null;

  @Column({ name: 'video_id', type: 'uuid', nullable: true })
  videoId: string | null;

  @Column({ name: 'listing_id', type: 'uuid', nullable: true })
  listingId: string | null;

  /** Chat: the thread, not the message. One unread row per conversation. */
  @Column({ name: 'conversation_id', type: 'uuid', nullable: true })
  conversationId: string | null;

  /**
   * Facts a money row prints and nothing joins to — an amount, a provider, a
   * tariff name. A column each would be four that are null on every other
   * kind.
   */
  @Column({ type: 'jsonb', nullable: true })
  meta: Record<string, unknown> | null;

  @Column({ name: 'comment_id', type: 'uuid', nullable: true })
  commentId: string | null;

  /** Null until opened. The index above is partial on exactly this. */
  @Column({ name: 'read_at', type: 'timestamptz', nullable: true })
  readAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
