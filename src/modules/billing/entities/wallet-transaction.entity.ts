import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { TxKind } from '../billing.constants';

@Entity('wallet_transactions')
@Index('IDX_wallet_transaction_user_created', ['userId', 'createdAt'])
// The last line of defence: whatever the code above it does, the database
// will not hold two TOPUP (or two TOPUP_BONUS) rows for one payment.
@Index('IDX_wallet_transaction_topup_once', ['referenceId', 'kind'], {
    unique: true, where: `kind IN ('TOPUP', 'TOPUP_BONUS')`,
})
// The same protection for a manual adjustment, which has no payment to key
// off. A double-clicked "credit 100 000" sends the same client_id twice and
// the second one is refused here rather than crediting again.
@Index('IDX_wallet_transaction_client', ['userId', 'clientId'], {
    unique: true, where: 'client_id IS NOT NULL',
})
export class WalletTransaction {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'user_id', type: 'uuid' })
    userId: string;

    @Column({ type: 'numeric', precision: 14, scale: 2 })
    amount: string;

    @Column({ type: 'varchar', length: 32 })
    kind: TxKind;

    @Column({ name: 'reference_id', type: 'uuid', nullable: true })
    referenceId: string | null;

    @Column({ name: 'balance_after', type: 'numeric', precision: 14, scale: 2 })
    balanceAfter: string;

    @Column({ type: 'text', nullable: true })
    note: string | null;

    /**
     * The caller's own key for one adjustment, so a retry or a double click
     * is the same adjustment rather than a second one. Null for everything
     * generated server-side (charges, bonuses), which cannot be double-sent.
     */
    @Column({ name: 'client_id', type: 'uuid', nullable: true })
    clientId: string | null;

    /**
     * Which admin made a manual adjustment. A column, not a prefix inside
     * `note`: "what has this admin changed" should be a WHERE, not a LIKE
     * over free text somebody can also type into.
     */
    @Column({ name: 'admin_id', type: 'uuid', nullable: true })
    adminId: string | null;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt: Date;

}
