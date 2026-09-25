import { CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * One person blocking another.
 *
 * Directional on purpose: A blocking B says nothing about what B has done,
 * and either side may block independently. The pair is the primary key, so
 * blocking twice is the same block rather than a second row.
 *
 * Both columns are indexed because both directions are asked constantly —
 * "who have I blocked" for the list, and "has this person blocked me" before
 * every message and every profile read.
 */
@Entity('user_blocks')
export class UserBlock {
  @Index() @PrimaryColumn({ name: 'blocker_id', type: 'uuid' }) blockerId: string;
  @Index() @PrimaryColumn({ name: 'blocked_id', type: 'uuid' }) blockedId: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}
