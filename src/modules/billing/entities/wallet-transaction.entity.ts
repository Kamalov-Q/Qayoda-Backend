import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { TxKind } from '../billing.constants';

@Entity('wallet_transactions')
@Index('IDX_wallet_transaction_user_created', ['userId', 'createdAt'])
// The last line of defence: whatever the code above it does, the database
// will not hold two TOPUP (or two TOPUP_BONUS) rows for one payment.
@Index('IDX_wallet_transaction_topup_once', ['referenceId', 'kind'], {
    unique: true, where: `kind IN ('TOPUP', 'TOPUP_BONUS')`,
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

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt: Date;

}
