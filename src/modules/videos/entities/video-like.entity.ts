import { CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * One heart on one reel.
 *
 * The pair is the primary key, so a double tap is one like: the second insert
 * conflicts instead of counting twice, and no read-then-write is needed to
 * find that out. `videos.like_count` is derived from these rows and is only
 * ever moved by the insert or delete that actually changed something.
 */
@Entity('video_likes')
@Index('IDX_video_likes_user', ['userId', 'createdAt'])
export class VideoLike {
  @PrimaryColumn({ name: 'video_id', type: 'uuid' }) videoId: string;
  @PrimaryColumn({ name: 'user_id', type: 'uuid' }) userId: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
