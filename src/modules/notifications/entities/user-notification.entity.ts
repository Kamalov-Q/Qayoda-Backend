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
// The two below were created by sql/2026-10-24-notifications-expansion.sql and
// never declared here — so `synchronize`, which is on in dev, saw indexes the
// entities did not know about and DROPPED them. That is not hypothetical: both
// were missing from the dev database by 2026-10-28.
//
// The unique one is what makes "one unread row per conversation" a guarantee
// rather than a hope: the service checks for an existing row and updates it,
// but that check and the insert are two statements, and two messages arriving
// together race straight through them. Losing it means a row per message —
// an inbox that grows without bound and a push for each one.
// Chat ONLY. The predicate used to be every unread row with a conversation
// on it, which is wrong the moment any other kind carries one: the five
// PRICE_BID_* kinds do, and a second offer in a thread hit a unique
// violation that notify() swallowed — the notification and its push both
// vanished. Bids must not collapse; each is a distinct number on the table.
@Index('uq_notifications_unread_conversation', ['userId', 'conversationId'], {
  unique: true,
  where:
    "conversation_id IS NOT NULL AND read_at IS NULL AND kind = 'CHAT_MESSAGE'",
})
@Index('idx_notifications_listing', ['userId', 'listingId', 'kind'], {
  where: 'listing_id IS NOT NULL',
})
// The three below index foreign-key columns that had nothing on them.
//
// Postgres does NOT index the referencing side of a foreign key — only the
// referenced side, by its primary key — so every delete of a user, video or
// comment had to scan this whole table to find the rows pointing at it, once
// per parent row removed. Partial, because the overwhelming majority of rows
// are null on each: a like carries no comment, a listing review carries no
// video.
@Index('idx_notifications_actor', ['actorId'], { where: 'actor_id IS NOT NULL' })
@Index('idx_notifications_video', ['videoId'], { where: 'video_id IS NOT NULL' })
@Index('idx_notifications_comment', ['commentId'], {
  where: 'comment_id IS NOT NULL',
})
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
