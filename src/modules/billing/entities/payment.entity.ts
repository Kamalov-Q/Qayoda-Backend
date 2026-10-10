import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { FiscalStatus, PaymentProviderKind, PaymentStatus } from '../billing.constants';

@Entity('payments')
@Index('IDX_payments_user_created', ['userId', 'createdAt'])
@Index('IDX_payments_status_created', ['status', 'createdAt'])
@Index('IDX_payments_provider_create_time', ['provider', 'providerCreateTime'])
// The app's own key for one top-up attempt: a retried or double-tapped
// request finds the order it already made instead of creating a second.
@Index('IDX_payments_user_client', ['userId', 'clientId'], { unique: true, where: 'client_id IS NOT NULL' })
@Index('IDX_payments_provider_txn', ['provider', 'providerTxnId'], { unique: true, where: 'provider_txn_id IS NOT NULL' })
export class Payment {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'user_id', type: 'uuid' })
    userId: string;

    @Column({ name: 'client_id', type: 'uuid', nullable: true })
    clientId: string | null;

    @Column({ type: 'varchar', length: 16 })
    provider: PaymentProviderKind;

    @Column({ type: 'numeric', precision: 14, scale: 2 })
    amount: string;

    @Column({ name: 'bonus_amount', type: 'numeric', precision: 14, scale: 2, default: 0 })
    bonusAmount: string;

    @Column({ type: 'varchar', length: 16, default: PaymentStatus.CREATED })
    status: PaymentStatus;

    /** Small integer for providers that want one (Click's merchant_prepare_id). */
    @Index('IDX_payments_prepare_id', { unique: true })
    @Column({ name: 'prepare_id', type: 'int', generated: 'increment' })
    prepareId: number;

    @Column({ name: 'provider_txn_id', type: 'varchar', length: 64, nullable: true })
    providerTxnId: string | null;

    /** Click's click_paydoc_id — the id its fiscal API wants. */
    @Column({ name: 'provider_doc_id', type: 'varchar', length: 64, nullable: true })
    providerDocId: string | null;

    @Column({ name: 'provider_payload', type: 'jsonb', nullable: true })
    providerPayload: Record<string, any> | null;

    @Column({ name: 'provider_error', type: 'varchar', length: 32, nullable: true })
    providerError: string | null;

    @Column({ name: 'provider_create_time', type: 'bigint', nullable: true })
    providerCreateTime: string | null;

    @Column({ name: 'provider_perform_time', type: 'bigint', nullable: true })
    providerPerformTime: string | null;

    @Column({ name: 'provider_cancel_time', type: 'bigint', nullable: true })
    providerCancelTime: string | null;

    @Column({ name: 'fiscal_status', type: 'varchar', length: 16, default: FiscalStatus.NONE })
    fiscalStatus: FiscalStatus;

    @Column({ name: 'fiscal_attempts', type: 'int', default: 0 })
    fiscalAttempts: number;

    @Column({ name: 'fiscal_response', type: 'jsonb', nullable: true })
    fiscalResponse: object | null;

    @Column({ name: 'fiscal_sent_at', type: 'timestamptz', nullable: true })
    fiscalSentAt: Date | null;

    @Column({ name: 'paid_at', type: 'timestamptz', nullable: true })
    paidAt: Date | null;

    @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true })
    cancelledAt: Date | null;

    @Column({ name: 'cancel_reason', type: 'varchar', length: 64, nullable: true })
    cancelReason: string | null;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
    updatedAt: Date;
}