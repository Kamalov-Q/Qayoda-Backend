import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import type { VideoReportStatus } from '../videos.constants';

/**
 * Somebody flagging a video — or one comment under it — for the moderators.
 *
 * One row per (video, comment, reporter): reporting the same thing twice is
 * refused rather than stacked, so the dashboard's count means "how many
 * people", not "how many taps" — the same rule as listing reports. Flagging
 * a video and then a comment under it are two different reports.
 *
 * Needed from day one because everyone can post. The alternative to a report
 * button is learning about the problem video from a phone call.
 */
@Entity('video_reports')
// Comment reports: one per person per comment.
@Unique('uq_video_report_reporter', ['videoId', 'reporterId', 'commentId'])
// Video reports: one per person per video. Its own partial index because
// Postgres counts NULLs as distinct — under the constraint above alone,
// (video, reporter, NULL) never collides with itself and the same person
// could flag the same clip all afternoon.
@Index('uq_video_report_video', ['videoId', 'reporterId'], {
  unique: true,
  where: 'comment_id IS NULL',
})
@Index('IDX_video_reports_status', ['status', 'createdAt'])
export class VideoReport {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Index() @Column({ name: 'video_id', type: 'uuid' }) videoId: string;
  @Index() @Column({ name: 'reporter_id', type: 'uuid' }) reporterId: string;

  /**
   * The comment being flagged, when it is a comment rather than the clip.
   *
   * One queue for both. A comment under a reel is reported for the same six
   * reasons, reviewed by the same person, and acted on with the same two
   * buttons — a second table would have been the same columns with a
   * different name on the front.
   */
  @Index()
  @Column({ name: 'comment_id', type: 'uuid', nullable: true })
  commentId: string | null;

  /** One of VIDEO_REPORT_REASONS — fixed keys, labels live client-side. */
  @Column({ type: 'varchar', length: 40 }) reason: string;

  /** Free text; required when the reason is OTHER, optional otherwise. */
  @Column({ type: 'text', nullable: true }) comment: string | null;

  @Column({ type: 'varchar', length: 20, default: 'OPEN' })
  status: VideoReportStatus;

  /** The admin who closed it, and what they wrote while doing so. */
  @Column({ name: 'resolved_by', type: 'uuid', nullable: true })
  resolvedBy: string | null;

  @Column({
    name: 'resolution_note',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  resolutionNote: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
