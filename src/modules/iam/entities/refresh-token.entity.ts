import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { User } from './user.entity';

@Entity('refresh_tokens')
export class RefreshToken {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'user_id' }) userId: string;
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;
  @Index() @Column({ name: 'token_hash' }) tokenHash: string;
  @Column({ name: 'device_id', type: 'varchar', length: 128, nullable: true })
  deviceId: string | null;
  @Column({ name: 'replaced_by_id', type: 'uuid', nullable: true })
  replacedById: string | null;
  @Column({ name: 'family_id' }) familyId: string;
  @Column({ name: 'expires_at', type: 'timestamptz' }) expiresAt: Date;
  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt: Date | null;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
}
