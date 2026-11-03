import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * One free go, already used.
 *
 * The presence of a row is the whole meaning: `(user_id, action)` exists =
 * this account has spent its free use of that action. There is no "unused"
 * row — an account that has never posted simply has nothing here, which is
 * why the grant needs no backfill and no row written at sign-up.
 *
 * The primary key is what makes it safe. Claiming is a single
 * `INSERT ... ON CONFLICT DO NOTHING RETURNING user_id`: two concurrent
 * listing posts race on the same key and exactly one gets a row back, so
 * exactly one goes free. See WalletService.chargeTariff.
 *
 * `reference_id` is the listing the grant paid for. Not required for the
 * mechanism — it is there so an admin asking "what did they get for free"
 * has an answer, the same reason wallet_transactions carries one.
 */
@Entity('free_grants')
@Index('IDX_free_grants_used_at', ['usedAt'])
export class FreeGrant {
    @PrimaryColumn({ name: 'user_id', type: 'uuid', primaryKeyConstraintName: 'PK_free_grants' })
    userId: string;

    /** A TariffAction — one of FIRST_FREE_ACTIONS. */
    @PrimaryColumn({ type: 'varchar', length: 40, primaryKeyConstraintName: 'PK_free_grants' })
    action: string;

    /** What it was spent on: the listing id, for a LISTING_POST grant. */
    @Column({ name: 'reference_id', type: 'uuid', nullable: true })
    referenceId: string | null;

    @CreateDateColumn({ name: 'used_at', type: 'timestamptz' })
    usedAt: Date;
}
