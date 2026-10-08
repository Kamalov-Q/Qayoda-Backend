
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { PaymentProviderKind } from '../billing.constants';

@Entity('payment_webhook_events')
@Index('IDX_payment_webhook_events_created', ['createdAt'])
export class PaymentWebhookEvent {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ type: 'varchar', length: 16 })
    provider: PaymentProviderKind;

    @Column({ type: 'varchar', length: 32, nullable: true })
    action: string | null;

    @Column({ type: 'jsonb' })
    body: object;

    @Column({ name: 'signature_valid', type: 'boolean' })
    signatureValid: boolean;

    @Column({ type: 'jsonb' })
    response: object;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt: Date;


}

