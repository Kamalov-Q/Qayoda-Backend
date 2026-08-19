import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index({ unique: true }) @Column({ type: 'citext' }) email: string;
  @Column({ length: 64 }) name: string;
  @Column({ length: 64 }) surname: string;

  @Column({ name: 'password_hash', type: 'text', nullable: true })
  passwordHash: string | null;
  @Column({ name: 'avatar_url', type: 'text', nullable: true }) avatarUrl:
    string | null;

  @Column({ name: 'avatar_thumb_url', type: 'text', nullable: true })
  avatarThumbUrl: string | null;

  @Column({ name: 'phone_number', type: 'varchar', length: 20, nullable: true })
  phoneNumber: string | null;

  @Column({ length: 16, default: 'user' }) role: 'user' | 'admin';
  @Column({ name: 'is_verified', default: false }) isVerified: boolean;

  @Column({ name: 'last_seen_at', type: 'timestamptz', nullable: true })
  lastSeenAt: Date | null;

  @Column({ name: 'is_online', default: false })
  isOnline: boolean;

  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
