import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
@Entity('outbox_events')
export class OutboxEvent {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column({ name: 'event_name', length: 64 }) eventName: string;

  @Column({ type: 'jsonb' }) payload: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;

  @Index()
  @Column({ name: 'dispatched_at', type: 'timestamptz', nullable: true })
  dispatchedAt: Date | null;
}
