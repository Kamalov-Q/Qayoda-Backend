import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

/**
 * One registered device.
 *
 * The Expo token is the primary key, not a surrogate: it IS the identity of
 * the installation, and making it the key is what lets a re-registration be
 * a single upsert that re-points the row at whoever is signed in now.
 */
@Entity('push_tokens')
@Index('idx_push_tokens_user', ['userId'])
export class PushToken {
  @PrimaryColumn({ type: 'text' }) token: string;

  @Column({ name: 'user_id', type: 'uuid' }) userId: string;

  @Column({ type: 'varchar', length: 10 }) platform: string;

  @Column({ name: 'last_seen_at', type: 'timestamptz' })
  lastSeenAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
