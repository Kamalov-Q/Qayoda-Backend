import { Column, CreateDateColumn, Entity, Index, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { Message } from './message.entity';
@Entity('conversations')
@Index('idx_conversations_last_message', ['lastMessageAt'])
export class Conversation {
  @PrimaryGeneratedColumn('uuid') id: string;

  /**
   * The advert this thread is about, or NULL for a direct one.
   *
   * Null means "about this person": the sellers directory lets somebody
   * write to a profile that has no live listing, and there is no advert to
   * hang that on. Uniqueness is two partial indexes rather than a
   * constraint — see sql/2026-10-24-direct-conversations.sql, because a
   * plain UNIQUE(listing_id, guest_id) stops meaning anything once the
   * column is nullable.
   */
  @Index() @Column({ name: 'listing_id', type: 'uuid', nullable: true })
  listingId: string | null;
  @Index() @Column({ name: 'host_id', type: 'uuid' }) hostId: string;
  @Index() @Column({ name: 'guest_id', type: 'uuid' }) guestId: string;

  /**
   * The pinned message, or null. One per conversation rather than Telegram's
   * stack: a two-person thread about one advert has one thing worth keeping
   * at the top — the address, the time, the price agreed — and a list of pins
   * would need its own screen to be usable.
   */
  @Column({ name: 'pinned_message_id', type: 'uuid', nullable: true })
  pinnedMessageId: string | null;

  @Column({ name: 'last_message_at', type: 'timestamptz', nullable: true })
  lastMessageAt: Date | null;

  @Column({
    name: 'last_message_preview',
    type: 'varchar',
    length: 160,
    nullable: true,
  })
  lastMessagePreview: string | null;

  @OneToMany(() => Message, (m) => m.conversation)
  messages: Message[];

  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
}
