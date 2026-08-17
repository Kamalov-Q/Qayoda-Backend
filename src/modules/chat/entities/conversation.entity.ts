import { Column, CreateDateColumn, Entity, Index, OneToMany, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { Message } from './message.entity';
@Entity('conversations')
@Unique(['listingId', 'guestId'])
@Index('idx_conversations_last_message', ['lastMessageAt'])
export class Conversation {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Index() @Column({ name: 'listing_id' }) listingId: string;
  @Index() @Column({ name: 'host_id' }) hostId: string;
  @Index() @Column({ name: 'guest_id' }) guestId: string;

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
