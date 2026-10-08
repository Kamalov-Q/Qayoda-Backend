import { DataSource, Repository } from 'typeorm';
import { Injectable, Logger } from "@nestjs/common";
import { WalletService } from './wallet.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Payment } from './entities/payment.entity';
import { PaymentWebhookEvent } from './entities/payment-webhook-event.entity';
import { fromTiyin, PAYMENT_TTL_HOURS, PaymentProviderKind, PaymentStatus, toTiyin, TxKind } from './billing.constants';
import { Cron, CronExpression } from '@nestjs/schedule';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Json = Record<string, unknown>;

@Injectable()
export class PaymentsService {
    private readonly logger = new Logger(PaymentsService.name);

    constructor(
        private readonly dataSource: DataSource,
        private readonly wallet: WalletService,
        @InjectRepository(Payment) private readonly payments: Repository<Payment>,
        @InjectRepository(PaymentWebhookEvent) private readonly events: Repository<PaymentWebhookEvent>
    ) { }

    async findByMerchantRef(provider: PaymentProviderKind, ref: string | undefined): Promise<Payment | null> {
        if (!ref || !UUID_RE.test(ref)) return null;
        return this.payments.findOne({ where: { id: ref, provider } });

    }

    /** False when the row was no longer open (cancelled or paid meanwhile). */
    async markPrepared(payment: Payment, providerTxnId: string, payload: Json): Promise<boolean> {
        const result = await this.payments
            .createQueryBuilder().update()
            .set({ status: PaymentStatus.PREPARED, providerTxnId, providerPayload: payload })
            .where('id = :id AND status IN (:...open)', {
                id: payment.id, open: [PaymentStatus.CREATED, PaymentStatus.PREPARED]
            })
            .execute();
        return !!result.affected;
    }

    async markPaid(payment: Payment, providerTxnId: string, payload: Json): Promise<boolean> {
        const amountTiyin = toTiyin(payment.amount);

        return this.dataSource.transaction(async (manager) => {
            // Serialise on the payment row: a second Complete for the same
            // order waits here until the first commits, then sees PAID.
            const [locked]: { status: PaymentStatus }[] = await manager.query(
                `SELECT status FROM payments WHERE id = $1 FOR UPDATE`, [payment.id],
            );
            if (locked?.status !== PaymentStatus.PREPARED) return false;

            const bonus = await this.wallet.bonusFor(manager, amountTiyin);

            // A raw UPDATE … RETURNING comes back as [rows, affectedCount].
            const [rows]: [{ id: string }[], number] = await manager.query(
                `UPDATE payments 
                SET status = 'PAID', bonus_amount = $1, paid_at = now(),
                provider_txn_id = $2, provider_payload = $3::jsonb, updated_at = now()
                WHERE id = $4 AND status = 'PREPARED'
                RETURNING id`,
                [fromTiyin(bonus.bonusTiyin), providerTxnId, JSON.stringify(payload), payment.id],
            );

            if (rows.length === 0) return false;

            await this.wallet.credit(manager, payment.userId, amountTiyin, TxKind.TOPUP, payment.id, `${payment.provider} ${providerTxnId}`);

            if (bonus.bonusTiyin > 0) {
                await this.wallet.credit(manager, payment.userId, bonus.bonusTiyin, TxKind.TOPUP_BONUS, payment.id, `+${bonus.percent}% bonus`);
            }

            this.logger.log(`Payment ${payment.id} PAID via ${payment.provider} (${payment.amount} + ${fromTiyin(bonus.bonusTiyin)} bonus)`);
            return true;

        })
    }

    async cancel(payment: Payment, reason: string, providerError: string | null, payload: Json | null): Promise<void> {
        await this.payments
            .createQueryBuilder().update()
            .set({
                status: PaymentStatus.CANCELLED, cancelledAt: () => 'now()', cancelReason: reason, providerError, ...(payload ? { providerPayload: payload } : {}),
            })
            .where('id = :id AND status IN (:...open)', {
                id: payment.id, open: [PaymentStatus.CREATED, PaymentStatus.PREPARED],
            })
            .execute();

    }

    async logWebhook(
        provider: PaymentProviderKind, action: string | null, body: Json, signatureValid: boolean, response: Json
    ): Promise<void> {
        // The audit row must never cost the provider its answer: a 500 here,
        // after the wallet was credited, would make Click reverse a payment
        // we already delivered.
        try {
            await this.events.insert({ provider, action, body, signatureValid, response });
        } catch (err) {
            this.logger.error(`webhook log failed: ${err instanceof Error ? err.message : err}`);
        }
    }

    @Cron(CronExpression.EVERY_HOUR)
    async expireStalePayments(): Promise<void> {
        const result = await this.payments
            .createQueryBuilder().update()
            .set({ status: PaymentStatus.CANCELLED, cancelledAt: () => 'now()', cancelReason: 'timeout' })
            .where('status IN (:...open)', { open: [PaymentStatus.CREATED, PaymentStatus.PREPARED] })
            // updated_at, not created_at: Prepare bumps it, so an order Click is
            // working on right now is never cancelled from under it.
            .andWhere(`updated_at < now() - interval '${PAYMENT_TTL_HOURS} hours'`)
            .execute();

        if (result.affected) this.logger.log(`Expired ${result.affected} stale payments`);

    }

}
