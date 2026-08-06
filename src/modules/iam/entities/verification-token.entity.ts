import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';
import { OtpPurpose } from '../../otp/enums/otp-purpose.enum';

@Entity('verification_tokens')
export class VerificationToken {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'citext' }) email: string;
  @Column({ type: 'enum', enum: OtpPurpose }) purpose: OtpPurpose;
  @Column({ name: 'expires_at', type: 'timestamptz' }) expiresAt: Date;
  @Column({ name: 'consumed_at', type: 'timestamptz', nullable: true })
  consumedAt: Date | null;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
}
