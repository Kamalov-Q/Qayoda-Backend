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
 * listing thread is moderated by the listing's owner and pushed over the
 * /listings websocket; neither is true under a reel, where the author
 * moderates and the sheet refetches. Merging the two is worth doing once a third kind of comment appears
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

  /** May be empty when the comment is a photo — see `imageUrl`. */
  @Column({ type: 'varchar', length: 1000, default: '' }) body: string;

  /**
   * One optional photo, uploaded through `POST /media/upload` before the
   * comment is created. Stored as the returned URLs rather than as a
   * relation: the media module already owns the file, and a comment only
   * needs to know where it is. Same shape as a listing comment's photo, so
   * the app renders both with one component.
   */
  @Column({ name: 'image_url', type: 'text', nullable: true })
  imageUrl: string | null;

  @Column({ name: 'image_thumb_url', type: 'text', nullable: true })
  imageThumbUrl: string | null;

  /** Kept so the thread can reserve the right space before the photo loads. */
  @Column({ name: 'image_width', type: 'int', nullable: true })
  imageWidth: number | null;

  @Column({ name: 'image_height', type: 'int', nullable: true })
  imageHeight: number | null;

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
