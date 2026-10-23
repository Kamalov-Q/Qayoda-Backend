import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * A comment under a reel. One level of nesting, like Instagram: a reply
 * points at a top-level comment and can never itself be replied to.
 *
 * Its own table rather than a `target_type` column on listing_comments. The
 * listing thread is moderated by the listing's owner, carries an optional
 * photo and is pushed over the /listings websocket; none of that is true
 * under a reel, where the author moderates, the body is text and the screen
 * polls. Merging the two is worth doing once a third kind of comment appears
 * — see the implementation guide.
 */
@Entity('video_comments')
@Index('IDX_video_comments_video', ['videoId', 'createdAt'])
@Index('IDX_video_comments_parent', ['parentId', 'createdAt'])
@Index('IDX_video_comments_author', ['authorId', 'createdAt'])
export class VideoComment {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column({ name: 'video_id', type: 'uuid' }) videoId: string;
  @Column({ name: 'author_id', type: 'uuid' }) authorId: string;

  /** Null for a top-level comment; otherwise the comment being replied to. */
  @Column({ name: 'parent_id', type: 'uuid', nullable: true })
  parentId: string | null;

  @Column({ type: 'varchar', length: 1000 }) body: string;

  /** Maintained by the service — a thread is read far more than written. */
  @Column({ name: 'like_count', type: 'int', default: 0 }) likeCount: number;
  @Column({ name: 'reply_count', type: 'int', default: 0 }) replyCount: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

/** One heart on one comment. Same key trick as VideoLike. */
@Entity('video_comment_likes')
@Index('IDX_video_comment_likes_user', ['userId', 'createdAt'])
export class VideoCommentLike {
  @PrimaryColumn({ name: 'comment_id', type: 'uuid' }) commentId: string;
  @PrimaryColumn({ name: 'user_id', type: 'uuid' }) userId: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
