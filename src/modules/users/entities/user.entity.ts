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
import type { Gender, SocialLinks } from '../user-profile.constants';

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
   * Short public account number ("Hisob raqami"): what the user types into
   * Paynet, and what the app's Paynet link carries. Never reused.
   */
  @Index('uq_users_account_no', { unique: true })
  @Column({ name: 'account_no', type: 'int', generated: 'increment' })
  accountNo: number;

  /**
   * Set only by a verified channel — an SMS OTP the user passed, or a phone a
   * provider vouched for. Never writable from the profile endpoint: a user who
   * could type in someone else's number would be handed their account the next
   * time that person signed in by SMS.
   */
  @Index('uq_users_phone', { unique: true })
  @Column({ name: 'phone_number', type: 'varchar', length: 13, nullable: true })
  phoneNumber: string | null; // +998901234567

  /**
   * bcrypt hash, chosen by the user right after onboarding. Null means "signs
   * in with an SMS code only". Never serialized into a response — only the
   * derived `hasPassword` flag leaves the server.
   */
  @Column({ name: 'password_hash', type: 'text', nullable: true })
  passwordHash: string | null;

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
  /**
   * Followers and followees, denormalised.
   *
   * Maintained by FollowsService — the rows in `follows` are the truth, and
   * these spare a COUNT on every profile open, which is the single most
   * visited screen after the feed.
   */
  @Column({ name: 'follower_count', type: 'int', default: 0 })
  followerCount: number;

  @Column({ name: 'following_count', type: 'int', default: 0 })
  followingCount: number;

  @Column({ name: 'is_verified_realtor', type: 'boolean', default: false })
  isVerifiedRealtor: boolean;

  // ---- who they are, as they describe themselves -------------------------

  /**
   * Date of birth, not an age.
   *
   * An age column is wrong within a year of being written and there is no way
   * to correct it without asking everybody again; this one answers the same
   * question forever. `date`, not `timestamptz`: a birthday is a calendar
   * day, and storing it with a zone moves it across the date line.
   *
   * Nullable because every account that existed before this column did has
   * none. New registrations are required to supply it — enforced in the
   * profile DTO, not here, so the old rows stay readable.
   */
  @Column({ name: 'birth_date', type: 'date', nullable: true })
  birthDate: string | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  gender: Gender | null;

  /** Where they are, in their own words. Not geocoded and not a listing. */
  @Column({ type: 'varchar', length: 255, nullable: true })
  address: string | null;

  @Column({ type: 'text', nullable: true })
  bio: string | null;

  /**
   * Platform → handle or URL, for the six the app draws icons for.
   *
   * One jsonb rather than six columns: the set is presentational, and adding
   * or dropping a platform should be a change to one constant and an icon,
   * not a migration. Keys are validated against SOCIAL_PLATFORMS on the way
   * in, so nothing unknown is ever stored.
   */
  @Column({ name: 'social_links', type: 'jsonb', nullable: true })
  socialLinks: SocialLinks | null;

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
