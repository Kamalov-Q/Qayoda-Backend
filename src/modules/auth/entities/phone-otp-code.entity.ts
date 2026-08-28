import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * SMS login codes. Its own table rather than the generic `otp_codes` the
 * email flow used: the only subject here is a phone number, and keeping the
 * two apart means the SMS path cannot be reached with an email-issued code.
 */
@Entity('phone_otp_codes')
@Index('idx_phone_otp_phone_created', ['phone', 'createdAt'])
export class PhoneOtpCode {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Normalized 998XXXXXXXXX */
  @Column({ type: 'varchar', length: 12 })
  phone: string;

  @Column({ name: 'code_hash', type: 'varchar', length: 120 })
  codeHash: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'consumed_at', type: 'timestamptz', nullable: true })
  consumedAt: Date | null;

  /** Wrong guesses. The code burns at 5 so a 6-digit code can't be brute-forced. */
  @Column({ type: 'int', default: 0 })
  attempts: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
