import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum TelegramSessionStatus {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  CONSUMED = 'CONSUMED',
  EXPIRED = 'EXPIRED',
}

@Entity('telegram_sessions')
@Index('uq_telegram_token', ['token'], { unique: true })
export class TelegramSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Random token embedded in the t.me deep link and shown as a short code. */
  @Column({ type: 'varchar', length: 64 })
  token: string;

  @Column({
    type: 'enum',
    enum: TelegramSessionStatus,
    default: TelegramSessionStatus.PENDING,
  })
  status: TelegramSessionStatus;

  /** Filled by the bot webhook once the user presses Start. */
  @Column({ name: 'telegram_id', type: 'varchar', length: 32, nullable: true })
  telegramId: string | null;

  @Column({ name: 'telegram_profile', type: 'jsonb', nullable: true })
  telegramProfile: Record<string, unknown> | null;

  /**
   * Set when an already-authenticated user starts the flow to LINK Telegram
   * rather than sign in with it.
   */
  @Column({ name: 'link_user_id', type: 'uuid', nullable: true })
  linkUserId: string | null;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
