import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

/**
 * One row per person per video, so `view_count` answers "how many people
 * watched this" rather than "how many times did it loop" — and a reel loops
 * until you swipe off it, so the second number is meaningless.
 *
 * Who a person is depends on whether they are signed in: `u:<userId>`
 * follows them across devices, `d:<deviceId>` is the value the app generates
 * once and keeps. Same scheme as listing_views, including the part where the
 * device key is forgeable and that is acceptable for a view counter.
 *
 * Only written after VIEW_MIN_WATCH_MS of actual watching, and in batches —
 * see VideoEngagementService.recordViews.
 */
@Entity('video_views')
@Index('IDX_video_views_user', ['userId', 'createdAt'])
export class VideoView {
  @PrimaryColumn({ name: 'video_id', type: 'uuid' }) videoId: string;

  /** `u:<uuid>` or `d:<deviceId>` — see the class comment. */
  @PrimaryColumn({ name: 'viewer_key', type: 'varchar', length: 80 })
  viewerKey: string;

  /** Set when the viewer was signed in; null for a guest. */
  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;

  /**
   * Longest single watch this viewer reported, in milliseconds. Nothing shows
   * it yet; it is here because watch-through is the one ranking signal worth
   * having and it cannot be reconstructed after the fact.
   */
  @Column({ name: 'watched_ms', type: 'int', default: 0 }) watchedMs: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
