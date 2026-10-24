import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { VideoStatus } from '../videos.constants';

/**
 * One uploaded clip: a reel in the Videos tab, and — when `listingId` is set
 * — the film of that listing as well.
 *
 * One table for both on purpose. The alternative was a listing-video table
 * and a reels table, which is two upload pipelines, two moderation queues and
 * two sets of counters for the same 40 MB of H.264. What makes a reel worth
 * posting in a property marketplace is precisely that it can point at an
 * advert, so the link is a nullable column rather than a different feature.
 *
 * The bytes live at Bunny Stream and never pass through this server, so
 * `providerId` is the only handle on them: everything about the file —
 * duration, dimensions, thumbnail, playback URLs — is either read back from
 * Bunny or derived from that id. See bunny-stream.service.ts.
 */
@Entity('videos')
@Index('IDX_videos_provider', ['providerId'], { unique: true })
@Index('IDX_videos_author', ['authorId', 'createdAt'])
@Index('IDX_videos_feed', ['rankAt', 'id'], { where: "status = 'READY'" })
@Index('IDX_videos_listing', ['listingId', 'publishedAt'], {
  where: "status = 'READY'",
})
@Index('IDX_videos_pending', ['status', 'updatedAt'])
export class Video {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column({ name: 'author_id', type: 'uuid' }) authorId: string;

  /** The listing this clip advertises, if any. Null = a standalone reel. */
  @Column({ name: 'listing_id', type: 'uuid', nullable: true })
  listingId: string | null;

  /** The Bunny Stream video GUID. */
  @Column({ name: 'provider_id', type: 'varchar', length: 64 })
  providerId: string;

  @Column({ type: 'varchar', length: 20, default: VideoStatus.UPLOADING })
  status: VideoStatus;

  /** Why it will never be published. Null unless status is FAILED. */
  @Column({ name: 'fail_reason', type: 'varchar', length: 32, nullable: true })
  failReason: string | null;

  @Column({ type: 'varchar', length: 2200, nullable: true })
  caption: string | null;

  /**
   * As Bunny measured the encoded file, not as the phone described it. The
   * 60-second limit is enforced against this number, which is why nothing is
   * charged until it exists.
   */
  @Column({ name: 'duration_sec', type: 'real', nullable: true })
  durationSec: number | null;

  @Column({ type: 'int', nullable: true }) width: number | null;
  @Column({ type: 'int', nullable: true }) height: number | null;

  /**
   * Bunny's name for the poster frame inside the video's own folder, e.g.
   * `thumbnail.jpg`. Stored rather than assumed: Bunny picks the name, and a
   * guessed one is a broken image on every card in the feed.
   */
  @Column({
    name: 'thumbnail_file',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  thumbnailFile: string | null;

  /**
   * Denormalised counters, all three maintained by VideoEngagementService
   * and VideoCommentsService and nothing else. The rows in video_likes /
   * video_views / video_comments are the truth; these spare the feed three
   * COUNT(*)s per video per page.
   *
   * There was a fourth, share_count. Nothing counts a share any more: the
   * native sheet never says whether anything was actually sent, so the
   * number measured intent and was read as reach.
   *
   * Written with `UPDATE … SET x = x + 1`, which is correct but serialises on
   * one row. That is fine at this size and is the thing to move to Redis if a
   * clip ever goes properly viral — one service, one file to change.
   */
  @Column({ name: 'like_count', type: 'int', default: 0 }) likeCount: number;
  @Column({ name: 'comment_count', type: 'int', default: 0 })
  commentCount: number;
  @Column({ name: 'view_count', type: 'int', default: 0 }) viewCount: number;

  /** When it went public, which is also when it was paid for. */
  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt: Date | null;

  /**
   * What the feed sorts on: `publishedAt` plus a few hours of credit for a
   * video that points at a listing (see LISTING_LINK_BOOST_HOURS).
   *
   * Stored instead of computed per request so the feed's keyset pagination
   * rides a plain index — an expression in the ORDER BY would mean a sort of
   * the whole published catalogue on every swipe.
   */
  @Column({ name: 'rank_at', type: 'timestamptz', nullable: true })
  rankAt: Date | null;

  @Column({ name: 'removed_at', type: 'timestamptz', nullable: true })
  removedAt: Date | null;

  /** The admin who took it down; null when the author removed their own. */
  @Column({ name: 'removed_by', type: 'uuid', nullable: true })
  removedBy: string | null;

  @Column({
    name: 'remove_reason',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  removeReason: string | null;

  /**
   * When the file was deleted at Bunny. A removed video keeps its row and its
   * record for a month (RETENTION_DAYS) so a moderation decision can still be
   * reviewed; this marks the point where the bytes stopped costing money.
   */
  @Column({ name: 'provider_purged_at', type: 'timestamptz', nullable: true })
  providerPurgedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
