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
 * A comment on a listing. Unlike a review, anyone may leave as many as they
 * like and none of them carry a rating — this is the question-and-answer
 * thread under the photos ("is it still available?", "is the price firm?"),
 * not a verdict on the place.
 *
 * One level of nesting, like Instagram: a reply points at a top-level comment
 * and can never itself be replied to. Arbitrary depth reads badly on a phone
 * and the service refuses it rather than rendering a ladder.
 */
@Entity('listing_comments')
export class ListingComment {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Index() @Column({ name: 'listing_id', type: 'uuid' }) listingId: string;
  @Index() @Column({ name: 'author_id', type: 'uuid' }) authorId: string;

  /** Null for a top-level comment; otherwise the comment being replied to. */
  @Index()
  @Column({ name: 'parent_id', type: 'uuid', nullable: true })
  parentId: string | null;

  /** May be empty when the comment is a photo — see `imageUrl`. */
  @Column({ type: 'text' }) body: string;

  /**
   * One optional photo, uploaded through `POST /media/upload` before the
   * comment is created. Stored as the returned URLs rather than as a
   * relation: the media module already owns the file, and a comment only
   * needs to know where it is.
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

  /**
   * Denormalized, maintained by the service. A thread is read far more often
   * than it is written, and these spare a COUNT per row on every page.
   */
  @Column({ name: 'like_count', type: 'int', default: 0 }) likeCount: number;
  @Column({ name: 'reply_count', type: 'int', default: 0 }) replyCount: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}

/**
 * One heart. The pair is the primary key, which is what makes liking twice
 * impossible without a read-then-write — the second insert simply conflicts.
 */
@Entity('listing_comment_likes')
export class ListingCommentLike {
  @PrimaryColumn({ name: 'comment_id', type: 'uuid' }) commentId: string;
  @PrimaryColumn({ name: 'user_id', type: 'uuid' }) userId: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}
