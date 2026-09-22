import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

export type ReportStatus = 'OPEN' | 'RESOLVED' | 'DISMISSED';

/**
 * A user flagging a listing for the moderators. One row per (listing,
 * reporter): reporting twice is refused rather than stacking duplicates,
 * so the dashboard's counts mean "how many people", not "how many taps".
 */
@Entity('listing_reports')
@Unique('uq_report_listing_reporter', ['listingId', 'reporterId'])
export class ListingReport {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Index() @Column({ name: 'listing_id', type: 'uuid' }) listingId: string;
  @Index() @Column({ name: 'reporter_id', type: 'uuid' }) reporterId: string;

  /** One of REPORT_REASONS — fixed keys, labels live client-side. */
  @Column({ type: 'varchar', length: 40 }) reason: string;

  /** Free text; required when the reason is OTHER, optional otherwise. */
  @Column({ type: 'text', nullable: true }) comment: string | null;

  @Index()
  @Column({ type: 'varchar', length: 20, default: 'OPEN' })
  status: ReportStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}
