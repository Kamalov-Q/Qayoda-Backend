import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  OneToMany,
  DeleteDateColumn,
} from 'typeorm';
import { AuthIdentity } from 'src/modules/auth/entities/auth-identity.entity';
import { UserRole, UserStatus } from 'src/shared/enums';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * Nullable because none of the sign-in providers is guaranteed to supply a
   * name: SMS gives one only if the sign-up screen asked, Telegram gives a
   * first name, Google gives a full name. The profile screen fills the gaps.
   */
  @Column({ type: 'varchar', length: 64, nullable: true })
  name: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  surname: string | null;

  @Column({ name: 'avatar_url', type: 'text', nullable: true })
  avatarUrl: string | null;

  @Column({ name: 'avatar_thumb_url', type: 'text', nullable: true })
  avatarThumbUrl: string | null;

  /**
   * Set only by a verified channel — an SMS OTP the user passed, or a phone a
   * provider vouched for. Never writable from the profile endpoint: a user who
   * could type in someone else's number would be handed their account the next
   * time that person signed in by SMS.
   */
  @Index('uq_users_phone', { unique: true })
  @Column({ name: 'phone_number', type: 'varchar', length: 13, nullable: true })
  phoneNumber: string | null; // +998901234567

  /** Same rule as `phoneNumber`: only ever a provider-verified address. */
  @Index('uq_users_email', { unique: true })
  @Column({ type: 'citext', nullable: true })
  email: string | null;

  @Column({ type: 'varchar', length: 2, default: 'uz' })
  language: 'uz' | 'ru';

  @Index('idx_users_role')
  @Column({ type: 'enum', enum: UserRole, default: UserRole.USER })
  role: UserRole;

  @Index('idx_users_status')
  @Column({ type: 'enum', enum: UserStatus, default: UserStatus.ACTIVE })
  status: UserStatus;

  @Column({ name: 'banned_at', type: 'timestamptz', nullable: true })
  bannedAt: Date | null;

  @Column({ name: 'banned_by', type: 'uuid', nullable: true })
  bannedBy: string | null;

  @Column({ name: 'ban_reason', type: 'text', nullable: true })
  banReason: string | null;

  /** Null = permanent. JwtAccessGuard treats a past date as no ban at all. */
  @Column({ name: 'ban_expires_at', type: 'timestamptz', nullable: true })
  banExpiresAt: Date | null;

  /** Trust badge shown on listings. Manual admin verification. */
  @Column({ name: 'is_verified_realtor', type: 'boolean', default: false })
  isVerifiedRealtor: boolean;

  @OneToMany(() => AuthIdentity, (i) => i.user)
  identities: AuthIdentity[];

  @Column({ name: 'last_seen_at', type: 'timestamptz', nullable: true })
  lastSeenAt: Date | null;

  @Column({ name: 'is_online', type: 'boolean', default: false })
  isOnline: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;

  @Column({ name: 'deleted_by', type: 'uuid', nullable: true })
  deletedBy: string | null;

  @Column({ name: 'delete_reason', type: 'text', nullable: true })
  deleteReason: string | null;
}
