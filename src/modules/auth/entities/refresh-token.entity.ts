import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { User } from 'src/modules/users/entities/user.entity';

@Entity('refresh_tokens')
@Index('idx_refresh_family', ['familyId'])
export class RefreshToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('idx_refresh_user')
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  /** SHA-256 of the random half of the presented token. */
  @Index('idx_refresh_token_hash')
  @Column({ name: 'token_hash', type: 'varchar', length: 64 })
  tokenHash: string;

  /**
   * One family per sign-in. Rotation keeps the family and replaces the token,
   * so replaying any token in a family can revoke the whole chain at once.
   */
  @Column({ name: 'family_id', type: 'varchar', length: 32 })
  familyId: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
