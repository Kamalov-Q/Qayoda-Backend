import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

export type SupportStatus = 'OPEN' | 'CLOSED';

/**
 * One person's line to the support team.
 *
 * Deliberately NOT a `conversations` row. A listing chat is two named people
 * talking about one advert; support is one person talking to whoever is on
 * duty, about anything, with no listing attached. Bending the chat schema to
 * cover both would have meant a nullable `listing_id` and a "host" that is
 * not a person, in the one module that is already working.
 *
 * One thread per user, reopened rather than duplicated: a support queue where
 * the same person appears four times is a queue nobody can work.
 */
@Entity('support_threads')
@Unique('uq_support_thread_user', ['userId'])
export class SupportThread {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Index() @Column({ name: 'user_id', type: 'uuid' }) userId: string;

  @Index()
  @Column({ type: 'varchar', length: 20, default: 'OPEN' })
  status: SupportStatus;

  /** What the queue sorts on — the thread waiting longest is the one to open. */
  @Index()
  @Column({ name: 'last_message_at', type: 'timestamptz', nullable: true })
  lastMessageAt: Date | null;

  /**
   * When each side last read the thread. The counters below answer "is there
   * anything new"; these answer "has what I sent been seen", which is the
   * question a tick mark on a message is actually about.
   */
  @Column({ name: 'user_read_at', type: 'timestamptz', nullable: true })
  userReadAt: Date | null;

  @Column({ name: 'admin_read_at', type: 'timestamptz', nullable: true })
  adminReadAt: Date | null;

  /**
   * The message kept at the top of the thread. One per thread, like a chat:
   * a support conversation has one thing worth pinning — the order number,
   * the address, the answer that resolved it.
   */
  @Column({ name: 'pinned_message_id', type: 'uuid', nullable: true })
  pinnedMessageId: string | null;

  /** Unread counts per side, so neither has to count rows to draw a badge. */
  @Column({ name: 'user_unread', type: 'int', default: 0 }) userUnread: number;
  @Column({ name: 'admin_unread', type: 'int', default: 0 })
  adminUnread: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}

@Entity('support_messages')
export class SupportMessage {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Index() @Column({ name: 'thread_id', type: 'uuid' }) threadId: string;

  /** The account that wrote it — a user, or whichever admin answered. */
  @Column({ name: 'sender_id', type: 'uuid' }) senderId: string;

  /**
   * Which side of the thread this came from, stored rather than derived.
   * An admin who is later demoted must not retroactively turn every answer
   * they wrote into a message from the customer.
   */
  @Column({ name: 'from_admin', type: 'boolean', default: false })
  fromAdmin: boolean;

  /**
   * TEXT, IMAGE, VOICE, VIDEO, VIDEO_NOTE or FILE — the same vocabulary the
   * chat uses, because anything from a chat can be forwarded in here and it
   * has to arrive as what it was.
   */
  @Column({ type: 'varchar', length: 20, default: 'TEXT' })
  type: string;

  /** May be empty when the message is an attachment, or a caption when not. */
  @Column({ type: 'text' }) body: string;

  /** Images keep their own pair; everything else uses `mediaUrl` below. */
  @Column({ name: 'image_url', type: 'text', nullable: true })
  imageUrl: string | null;

  @Column({ name: 'image_thumb_url', type: 'text', nullable: true })
  imageThumbUrl: string | null;

  // ---- non-image attachments (voice, video, files) ----
  @Column({ name: 'media_url', type: 'text', nullable: true })
  mediaUrl: string | null;

  @Column({ name: 'file_name', type: 'varchar', length: 255, nullable: true })
  fileName: string | null;

  @Column({ name: 'file_size', type: 'bigint', nullable: true })
  fileSize: string | null;

  @Column({ name: 'mime_type', type: 'varchar', length: 128, nullable: true })
  mimeType: string | null;

  @Column({ name: 'duration_sec', type: 'int', nullable: true })
  durationSec: number | null;

  /** 0–100 amplitude bars, so a forwarded voice note still draws its wave. */
  @Column({ type: 'jsonb', nullable: true })
  waveform: number[] | null;

  /**
   * Who originally said it, when this was forwarded in from a chat. Snapshot,
   * not a join: a forward is a quotation and must keep its attribution even
   * after the account is gone.
   */
  @Column({
    name: 'forwarded_from_name',
    type: 'varchar',
    length: 120,
    nullable: true,
  })
  forwardedFromName: string | null;

  /** Kept alongside the name so the attribution can open their profile. */
  @Column({ name: 'forwarded_from_user_id', type: 'uuid', nullable: true })
  forwardedFromUserId: string | null;

  /** The message this answers, within the same thread. */
  @Column({ name: 'reply_to_id', type: 'uuid', nullable: true })
  replyToId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}
