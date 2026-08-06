import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { OtpPurpose } from '../enums/otp-purpose.enum';
import { OtpChannel } from '../enums/otp-channel.enum';

@Entity('otp_codes')
export class OtpCode {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column() subject: string;
  @Column({ type: 'enum', enum: OtpChannel }) channel: OtpChannel;
  @Column({ type: 'enum', enum: OtpPurpose }) purpose: OtpPurpose;
  @Column({ name: 'code_hash' }) codeHash: string;
  @Column({ type: 'int', default: 0 }) attempts: number;
  @Column({ name: 'expires_at', type: 'timestamptz' }) expiresAt: Date;
  @Column({ name: 'consumed_at', type: 'timestamptz', nullable: true })
  consumedAt: Date | null;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
}
