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
  @Column({ length: 16, default: 'user' }) role: 'user' | 'admin';
  @Column({ name: 'is_verified', default: false }) isVerified: boolean;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
