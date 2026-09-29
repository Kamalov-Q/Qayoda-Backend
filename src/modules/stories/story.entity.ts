import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** What the story is made of. A caption can ride on any of them. */
export type StoryType = 'IMAGE' | 'VIDEO' | 'TEXT';
export const STORY_TYPES = ['IMAGE', 'VIDEO', 'TEXT'] as const;

/** How long a story may be left up. The poster picks one; the row dies on its
 *  own after it, without a sweeper — every read filters on `expires_at`. */
export const STORY_HOURS = [6, 12, 24, 48] as const;
export type StoryHours = (typeof STORY_HOURS)[number];

/**
 * A story: something somebody wanted seen today and not kept.
 *
 * Public by design — anyone signed in may post, anyone at all may watch. That
 * is the difference between this and a listing: a listing is an offer that
 * has to stand up to being found weeks later, a story is a shout across a
 * marketplace, and the expiry is what makes the difference honest.
 *
 * The author is a plain uuid rather than a relation, the same precedent the
 * reviews, comments and reports tables set: this module needs three columns
 * of `users`, not its entity graph.
 */
@Entity('stories')
export class Story {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Index() @Column({ name: 'author_id', type: 'uuid' }) authorId: string;

  @Column({ type: 'varchar', length: 12 }) type: StoryType;

  /** The photo or the video. Null on a text-only story. */
  @Column({ name: 'media_url', type: 'text', nullable: true })
  mediaUrl: string | null;

  /** A still to show while the video loads, and the tray's thumbnail. */
  @Column({ name: 'thumb_url', type: 'text', nullable: true })
  thumbUrl: string | null;

  @Column({ type: 'int', nullable: true }) width: number | null;
  @Column({ type: 'int', nullable: true }) height: number | null;

  /** Videos only. Drives how long the progress bar takes to fill. */
  @Column({ name: 'duration_sec', type: 'real', nullable: true })
  durationSec: number | null;

  /**
   * The words. A caption over a photo, or the whole story when there is no
   * media — which is why image, video and text are one table and not three:
   * every combination of the three is a story somebody meant to post.
   */
  @Column({ type: 'text', nullable: true }) body: string | null;

  /** Index into the app's palette, for a text story's background. */
  @Column({ name: 'background', type: 'int', default: 0 }) background: number;

  /**
   * The listing this story is about, when it is about one. Optional on
   * purpose: "come and see this flat" and "good morning from the office" are
   * both stories, and only one of them has somewhere to send you.
   */
  @Index()
  @Column({ name: 'listing_id', type: 'uuid', nullable: true })
  listingId: string | null;

  /** Denormalised, like every other count in this codebase — a tray of
   *  stories must not cost a COUNT per story. */
  @Column({ name: 'view_count', type: 'int', default: 0 }) viewCount: number;
  @Column({ name: 'reaction_count', type: 'int', default: 0 })
  reactionCount: number;

  @Index()
  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

/**
 * Who has watched a story. One row per person, so the author's "seen by"
 * list is a list of people rather than of openings — and so the tray knows
 * which stories to ring in green.
 *
 * Signed-in viewers only: an anonymous face in a "seen by" list is not worth
 * showing, and the tray's unseen ring needs an account to hang off anyway.
 */
@Entity('story_views')
export class StoryView {
  @PrimaryColumn({ name: 'story_id', type: 'uuid' }) storyId: string;
  @PrimaryColumn({ name: 'viewer_id', type: 'uuid' }) viewerId: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

/**
 * One reaction per person per story, replaceable — the Telegram model. A
 * second tap of the same emoji takes it back.
 *
 * The composite primary key IS the uniqueness rule, so there is no separate
 * unique constraint: adding one would build a second index over the same two
 * columns for nothing.
 */
@Entity('story_reactions')
export class StoryReaction {
  @PrimaryColumn({ name: 'story_id', type: 'uuid' }) storyId: string;
  @PrimaryColumn({ name: 'user_id', type: 'uuid' }) userId: string;

  /** A single emoji. Short varchar rather than text: it is one character. */
  @Column({ type: 'varchar', length: 16 }) emoji: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
