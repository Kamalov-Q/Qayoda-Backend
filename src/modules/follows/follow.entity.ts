import { CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * One person following another.
 *
 * Directional and not mutual: following a realtor says nothing about what
 * they think of you, and there is no request to accept — everything in this
 * app is public, so a follow is a subscription, not a relationship.
 *
 * The pair is the primary key, which is what makes following twice the same
 * follow rather than a second row. Both directions are indexed because both
 * are asked constantly: "whose videos should I see" on every Following feed,
 * and "how many followers does this seller have" on every profile.
 */
@Entity('follows')
@Index('IDX_follows_followee', ['followeeId', 'createdAt'])
@Index('IDX_follows_follower', ['followerId', 'createdAt'])
export class Follow {
  @PrimaryColumn({ name: 'follower_id', type: 'uuid' }) followerId: string;
  @PrimaryColumn({ name: 'followee_id', type: 'uuid' }) followeeId: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
