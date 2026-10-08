import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type VerificationStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

/**
 * One application for the verified badge.
 *
 * The row keeps everything about the attempt — the three documents, the
 * decision, who made it, when, and what the applicant was told — so the
 * dashboard can show a decided application in full months later. That is a
 * standing copy of somebody's passport: the columns are nullable because
 * earlier applications were cleared on decision, and because a request to
 * erase one has to be answerable.
 *
 * History is kept per attempt rather than overwritten: somebody rejected
 * twice for the same thing is a different case from a first-time applicant,
 * and the desk can only see that if the earlier rows survive.
 */
@Entity('verification_requests')
// One open application per person. Partial, so the rejected and approved rows
// of previous attempts do not collide with a new one.
@Index('uq_verification_pending', ['userId'], {
  unique: true,
  where: "status = 'PENDING'",
})
export class VerificationRequest {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Index() @Column({ name: 'user_id', type: 'uuid' }) userId: string;

  @Index()
  @Column({ type: 'varchar', length: 20, default: 'PENDING' })
  status: VerificationStatus;

  /** Null only on applications decided before documents were retained. */
  @Column({ name: 'passport_front_url', type: 'text', nullable: true })
  passportFrontUrl: string | null;

  @Column({ name: 'passport_back_url', type: 'text', nullable: true })
  passportBackUrl: string | null;

  /** The applicant holding the document, which is what ties it to them. */
  @Column({ name: 'selfie_url', type: 'text', nullable: true })
  selfieUrl: string | null;

  @Column({ name: 'reviewer_id', type: 'uuid', nullable: true })
  reviewerId: string | null;

  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true })
  reviewedAt: Date | null;

  /** Exactly what was sent to the applicant in support, kept verbatim so the
   *  desk can see what they were already told before telling them again. */
  @Column({ name: 'rejection_reason', type: 'text', nullable: true })
  rejectionReason: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
