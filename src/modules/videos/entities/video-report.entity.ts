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
 * Somebody flagging a video for the moderators.
 *
 * One row per (video, reporter): reporting twice is refused rather than
 * stacked, so the dashboard's count means "how many people", not "how many
 * taps" — the same rule as listing reports, and for the same reason.
 *
 * Needed from day one because everyone can post. The alternative to a report
 * button is learning about the problem video from a phone call.
 */
@Entity('video_reports')
@Unique('uq_video_report_reporter', ['videoId', 'reporterId'])
@Index('IDX_video_reports_status', ['status', 'createdAt'])
export class VideoReport {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Index() @Column({ name: 'video_id', type: 'uuid' }) videoId: string;
  @Index() @Column({ name: 'reporter_id', type: 'uuid' }) reporterId: string;

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
