import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import type { ReportStatus } from '../reports/report.entity';

/**
 * Somebody flagging a story for the moderators.
 *
 * One row per (story, reporter), like every other report table here, so the
 * dashboard's counts mean "how many people", not "how many taps".
 *
 * The story's own content is copied onto the row. A story expires — often
 * within hours, and sometimes before a moderator has looked — and a report
 * that says only "story 3f2c was offensive" is a report nobody can act on.
 * This is the one place in the codebase that denormalises deliberately
 * against the source disappearing.
 */
@Entity('story_reports')
@Unique('uq_story_report_story_reporter', ['storyId', 'reporterId'])
export class StoryReport {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Index() @Column({ name: 'story_id', type: 'uuid' }) storyId: string;
  @Index() @Column({ name: 'reporter_id', type: 'uuid' }) reporterId: string;
  /** Who posted it — kept so the dashboard can act on the person. */
  @Index() @Column({ name: 'author_id', type: 'uuid' }) authorId: string;

  /** One of STORY_REPORT_REASONS — fixed keys, labels live client-side. */
  @Column({ type: 'varchar', length: 40 }) reason: string;

  /** Free text; required when the reason is OTHER, optional otherwise. */
  @Column({ type: 'text', nullable: true }) comment: string | null;

  /** What was reported, as it was — see the class comment. */
  @Column({ name: 'story_type', type: 'varchar', length: 12 })
  storyType: string;
  @Column({ name: 'story_media_url', type: 'text', nullable: true })
  storyMediaUrl: string | null;
  @Column({ name: 'story_thumb_url', type: 'text', nullable: true })
  storyThumbUrl: string | null;
  @Column({ name: 'story_body', type: 'text', nullable: true })
  storyBody: string | null;

  @Index()
  @Column({ type: 'varchar', length: 20, default: 'OPEN' })
  status: ReportStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}
