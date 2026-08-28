import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { User } from 'src/modules/users/entities/user.entity';
import { AuthProvider } from 'src/shared/enums';

@Entity('auth_identities')
// One provider account maps to exactly one user, forever.
@Unique('uq_identity_provider', ['provider', 'providerId'])
// One provider per user — you cannot attach two Google accounts to one login.
@Unique('uq_identity_user_provider', ['userId', 'provider'])
@Index('idx_identity_user', ['userId'])
export class AuthIdentity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, (u) => u.identities, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'enum', enum: AuthProvider })
  provider: AuthProvider;

  /** Phone: 998901234567. Google: `sub`. Telegram: numeric chat id. */
  @Column({ name: 'provider_id', type: 'varchar', length: 128 })
  providerId: string;

  /** Snapshot from the provider at link time — display only, never trusted for auth. */
  @Column({ type: 'jsonb', nullable: true })
  profile: Record<string, unknown> | null;

  @Column({ name: 'last_used_at', type: 'timestamptz', nullable: true })
  lastUsedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
