import { DataSource, Repository } from 'typeorm';
import { HttpException, HttpStatus, Injectable, Logger } from "@nestjs/common";
import { WalletService } from './wallet.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Payment } from './entities/payment.entity';
import { PaymentWebhookEvent } from './entities/payment-webhook-event.entity';
import {
    FISCAL_CLAIM_STALE_MINUTES, FISCAL_MAX_ATTEMPTS, FiscalStatus, fromTiyin, PAYMENT_TTL_HOURS, PaymentProviderKind,
    PaymentStatus, toTiyin, TxKind,
} from './billing.constants';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OutBoxService } from 'src/shared/events/outbox.service';
import { BILLING_EVENTS, PaymentCancelledEvent, PaymentPaidEvent, PaymentReversedEvent } from './billing.events';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OPEN = [PaymentStatus.CREATED, PaymentStatus.PREPARED];

type Json = Record<string, any>;

export class ReversalNotPossibleError extends Error {
    constructor() {
        super('Balance already spent; reversal not possible');
    }
}

export class ProviderMismatchError extends Error {
    constructor(expected: PaymentProviderKind, actual: PaymentProviderKind, paymentId: string) {
        super(`Payment ${paymentId} belongs to ${actual}, not ${expected}`);
    }
}

/**
 * The provider-neutral payment state machine: CREATED → PREPARED → PAID, or
 * → CANCELLED; PAID → CANCELLED only through reverse(). Push-model providers
 * (Paynet) enter directly at PAID through recordPushPayment(). Every
 * transition is a conditional UPDATE on the current status, so a retried or
 * concurrent callback can never apply twice.
 *
 * Every transition writes its billing.payment.* event to the outbox IN THE
 * SAME TRANSACTION: the event exists if and only if the change committed, and
 * OutboxRelayService delivers it even across a crash.
 */
@Injectable()
export class PaymentsService {
    private readonly logger = new Logger(PaymentsService.name);

    constructor(
        private readonly dataSource: DataSource,
        private readonly wallet: WalletService,
        private readonly outbox: OutBoxService,
        @InjectRepository(Payment) private readonly payments: Repository<Payment>,
        @InjectRepository(PaymentWebhookEvent) private readonly webhookEvents: Repository<PaymentWebhookEvent>
    ) { }

    findById(id: string): Promise<Payment | null> {
        return this.payments.findOne({ where: { id } });
    }

    async findByMerchantRef(provider: PaymentProviderKind, ref: string | undefined): Promise<Payment | null> {
        if (typeof ref !== 'string' || !UUID_RE.test(ref)) return null;
        return this.payments.findOne({ where: { id: ref, provider } });
    }

    findByPrepareId(provider: PaymentProviderKind, prepareId: number): Promise<Payment | null> {
        return this.payments.findOne({ where: { prepareId, provider } });
    }

    async findByProviderTxn(provider: PaymentProviderKind, providerTxnId: string | undefined): Promise<Payment | null> {
        if (!providerTxnId) return null;
        return this.payments.findOne({ where: { provider, providerTxnId } });
    }

    listByCreateTime(provider: PaymentProviderKind, fromMs: number, toMs: number): Promise<Payment[]> {
        return this.payments
            .createQueryBuilder('p')
            .where('p.provider = :provider', { provider })
            .andWhere('p.providerCreateTime BETWEEN :from AND :to', { from: String(fromMs), to: String(toMs) })
            .orderBy('p.providerCreateTime', 'ASC')
            .getMany();
    }

    /** Paynet reconciliation (GetStatement): the money we kept, by when it arrived. */
    listPaidBetween(provider: PaymentProviderKind, from: Date, to: Date): Promise<Payment[]> {
        return this.payments
            .createQueryBuilder('p')
            .where('p.provider = :provider AND p.status = :paid', { provider, paid: PaymentStatus.PAID })
            .andWhere('p.paidAt BETWEEN :from AND :to', { from, to })
            .orderBy('p.paidAt', 'ASC')
            .getMany();
    }

    /**
     * Receipts still owed: PENDING ones, plus SENDING claims a crashed submit
     * left behind. FAILED is NOT retried — it has used up its attempts and is
     * waiting for a person.
     */
    listFiscalDue(provider: PaymentProviderKind, limit = 50): Promise<Payment[]> {
        return this.payments
            .createQueryBuilder('p')
            .where('p.provider = :provider AND p.status = :paid', { provider, paid: PaymentStatus.PAID })
            .andWhere(
                `(p.fiscalStatus = :pending OR (p.fiscalStatus = :sending AND p.updatedAt < now() - interval '${FISCAL_CLAIM_STALE_MINUTES} minutes'))`,
                { pending: FiscalStatus.PENDING, sending: FiscalStatus.SENDING },
            )
            .orderBy('p.paidAt', 'ASC')
            .take(limit)
            .getMany();
    }

    /**
     * The provider accepted the order and opened its transaction. Returns false
     * when the order was no longer open (cancelled or paid meanwhile).
     */
    async markPrepared(
        provider: PaymentProviderKind, payment: Payment, providerTxnId: string, payload: Json,
        createTimeMs = Date.now(), providerDocId: string | null = null,
    ): Promise<boolean> {
        this.assertProvider(provider, payment);
        const result = await this.payments
            .createQueryBuilder().update()
            .set({
                status: PaymentStatus.PREPARED,
                providerTxnId,
                providerDocId,
                providerPayload: payload,
                providerCreateTime: String(createTimeMs),
            })
            .where('id = :id AND provider = :provider AND status IN (:...open)', { id: payment.id, provider, open: OPEN })
            .execute();
        return !!result.affected;
    }

    /**
     * Money taken. Locks the row, flips PREPARED→PAID, credits the wallet
     * (amount + tier bonus) and writes billing.payment.paid in ONE transaction;
     * a retried or concurrent call finds it no longer PREPARED and credits nothing. `fiscal` says who sends
     * the receipt to the tax authority. Returns false if it was not PREPARED.
     */
    async markPaid(
        provider: PaymentProviderKind,
        payment: Payment,
        providerTxnId: string,
        payload: Json,
        fiscal: FiscalStatus.PENDING | FiscalStatus.BY_PROVIDER | FiscalStatus.NONE,
        performTimeMs = Date.now(),
        providerDocId: string | null = null,
    ): Promise<boolean> {
        this.assertProvider(provider, payment);
        const amountTiyin = toTiyin(payment.amount);

        const outcome = await this.dataSource.transaction(async (manager) => {
            // Serialise on the payment row: a second call waits here until the
            // first commits, then sees PAID and stops.
            const [locked]: { status: PaymentStatus }[] = await manager.query(
                `SELECT status FROM payments WHERE id = $1 AND provider = $2 FOR UPDATE`, [payment.id, provider],
            );
            if (locked?.status !== PaymentStatus.PREPARED) return null;

            const bonus = await this.wallet.bonusFor(manager, amountTiyin);
            const bonusAmount = fromTiyin(bonus.bonusTiyin);

            // TypeORM answers a raw UPDATE … RETURNING with [rows, affectedCount].
            const [rows]: [{ id: string }[], number] = await manager.query(
                `UPDATE payments
                    SET status = 'PAID', bonus_amount = $1, paid_at = now(), provider_perform_time = $2,
                        provider_txn_id = $3, provider_doc_id = COALESCE($4, provider_doc_id),
                        provider_payload = $5::jsonb, fiscal_status = $6, updated_at = now()
                  WHERE id = $7 AND provider = $8 AND status = 'PREPARED'
                  RETURNING id`,
                [bonusAmount, String(performTimeMs), providerTxnId, providerDocId, JSON.stringify(payload), fiscal, payment.id, provider],
            );
            if (rows.length === 0) return null;

            let balance = await this.wallet.credit(manager, payment.userId, amountTiyin, TxKind.TOPUP, payment.id, `${provider} ${providerTxnId}`);
            if (bonus.bonusTiyin > 0) {
                balance = await this.wallet.credit(manager, payment.userId, bonus.bonusTiyin, TxKind.TOPUP_BONUS, payment.id, `${provider} +${bonus.percent}% bonus`);
            }

            await this.outbox.publish(
                BILLING_EVENTS.PAYMENT_PAID,
                { ...new PaymentPaidEvent(payment.id, payment.userId, provider, payment.amount, bonusAmount, balance) },
                manager,
            );
            return { bonusAmount };
        });

        if (!outcome) return false;
        this.logger.log(`Payment ${payment.id} PAID via ${provider}: ${payment.amount} + ${outcome.bonusAmount} bonus`);
        return true;
    }

    /**
     * A PUSH-model top-up (Paynet): the provider pays an account, not an order
     * we made, so the row is born PAID. Insert + wallet credit + outbox event
     * are ONE transaction; the unique (provider, provider_txn_id) index decides
     * a duplicate — the loser inserts nothing and gets null.
     */
    async recordPushPayment(
        provider: PaymentProviderKind, userId: string, amountTiyin: number, providerTxnId: string, payload: Json,
        fiscal: FiscalStatus.PENDING | FiscalStatus.BY_PROVIDER | FiscalStatus.NONE,
    ): Promise<Payment | null> {
        const amount = fromTiyin(amountTiyin);

        const outcome = await this.dataSource.transaction(async (manager) => {
            const bonus = await this.wallet.bonusFor(manager, amountTiyin);
            const bonusAmount = fromTiyin(bonus.bonusTiyin);
            const now = String(Date.now());

            // INSERT … RETURNING comes back as plain rows (only UPDATE/DELETE get [rows, count]).
            const rows: { id: string }[] = await manager.query(
                `INSERT INTO payments (user_id, provider, amount, bonus_amount, status, provider_txn_id, provider_payload,
                                       provider_create_time, provider_perform_time, fiscal_status, paid_at)
                 VALUES ($1, $2, $3, $4, 'PAID', $5, $6::jsonb, $7, $7, $8, now())
                 ON CONFLICT (provider, provider_txn_id) WHERE provider_txn_id IS NOT NULL DO NOTHING
                 RETURNING id`,
                [userId, provider, amount, bonusAmount, providerTxnId, JSON.stringify(payload), now, fiscal],
            );
            if (rows.length === 0) return null;
            const paymentId = rows[0].id;

            let balance = await this.wallet.credit(manager, userId, amountTiyin, TxKind.TOPUP, paymentId, `${provider} ${providerTxnId}`);
            if (bonus.bonusTiyin > 0) {
                balance = await this.wallet.credit(manager, userId, bonus.bonusTiyin, TxKind.TOPUP_BONUS, paymentId, `${provider} +${bonus.percent}% bonus`);
            }

            await this.outbox.publish(
                BILLING_EVENTS.PAYMENT_PAID,
                { ...new PaymentPaidEvent(paymentId, userId, provider, amount, bonusAmount, balance) },
                manager,
            );
            return { paymentId, bonusAmount };
        });

        if (!outcome) return null;
        this.logger.log(`Payment ${outcome.paymentId} PAID via ${provider}: ${amount} + ${outcome.bonusAmount} bonus`);
        return this.payments.findOneOrFail({ where: { id: outcome.paymentId } });
    }

    async cancel(
        provider: PaymentProviderKind, payment: Payment, reason: string,
        providerError: string | null,
        payload: Json | null, cancelTimeMs = Date.now(),
    ): Promise<boolean> {
        this.assertProvider(provider, payment);

        return this.dataSource.transaction(async (manager) => {
            const result = await manager
                .createQueryBuilder().update(Payment)
                .set({
                    status: PaymentStatus.CANCELLED, cancelledAt: () => 'now()', cancelReason: reason, providerError,
                    providerCancelTime: String(cancelTimeMs), ...(payload ? { providerPayload: payload } : {}),
                })
                .where('id = :id AND provider = :provider AND status IN (:...open)', { id: payment.id, provider, open: OPEN })
                .execute();

            if (!result.affected) return false;
            await this.outbox.publish(
                BILLING_EVENTS.PAYMENT_CANCELLED,
                { ...new PaymentCancelledEvent(payment.id, payment.userId, provider, reason) },
                manager,
            );
            return true;
        });
    }

    /**
     * The provider takes back an already-paid top-up. Only if the balance still
     * covers amount + bonus; otherwise ReversalNotPossibleError and nothing
     * changes. Returns false if the payment was not PAID (nothing to reverse).
     */
    async reverse(
        provider: PaymentProviderKind, payment: Payment, reason: string, providerError: string | null,
        cancelTimeMs = Date.now(),
    ): Promise<boolean> {
        this.assertProvider(provider, payment);
        const total = toTiyin(payment.amount) + toTiyin(payment.bonusAmount);

        return this.dataSource.transaction(async (manager) => {
            const [rows]: [{ id: string }[], number] = await manager.query(
                `UPDATE payments
                    SET status = 'CANCELLED', cancelled_at = now(), cancel_reason = $1, provider_error = $2,
                        provider_cancel_time = $3, updated_at = now()
                  WHERE id = $4 AND provider = $5 AND status = 'PAID'
                  RETURNING id`,
                [reason, providerError, String(cancelTimeMs), payment.id, provider],
            );
            if (rows.length === 0) return false;

            let balance: string;
            try {
                balance = await this.wallet.debit(manager, payment.userId, total, TxKind.REFUND, payment.id, `${provider} reversal`);
            } catch (err) {
                // Only "not enough balance" means the money is spent; anything
                // else is a real failure and must surface as one.
                if (err instanceof HttpException && err.getStatus() === Number(HttpStatus.PAYMENT_REQUIRED)) {
                    throw new ReversalNotPossibleError();
                }
                throw err;
            }

            await this.outbox.publish(
                BILLING_EVENTS.PAYMENT_REVERSED,
                { ...new PaymentReversedEvent(payment.id, payment.userId, provider, fromTiyin(total), balance) },
                manager,
            );
            return true;
        });
    }

    // ─── fiscal bookkeeping ───────────────────────────────────────────────

    /**
     * Take the right to send this payment's receipt. Exactly one caller wins
     * (the paid-event listener and the retry cron can race), so a receipt is
     * never submitted twice.
     */
    async claimFiscal(paymentId: string): Promise<boolean> {
        const result = await this.payments
            .createQueryBuilder().update()
            .set({ fiscalStatus: FiscalStatus.SENDING })
            .where(
                `id = :id AND status = :paid AND (fiscal_status = :pending
                   OR (fiscal_status = :sending AND updated_at < now() - interval '${FISCAL_CLAIM_STALE_MINUTES} minutes'))`,
                { id: paymentId, paid: PaymentStatus.PAID, pending: FiscalStatus.PENDING, sending: FiscalStatus.SENDING },
            )
            .execute();
        return !!result.affected;
    }

    async markFiscalResult(paymentId: string, ok: boolean, response: Json): Promise<void> {
        await this.payments
            .createQueryBuilder().update()
            .set({
                fiscalStatus: () => ok
                    ? `'${FiscalStatus.SENT}'`
                    : `CASE WHEN fiscal_attempts + 1 >= ${FISCAL_MAX_ATTEMPTS} THEN '${FiscalStatus.FAILED}' ELSE '${FiscalStatus.PENDING}' END`,
                fiscalAttempts: () => 'fiscal_attempts + 1',
                fiscalResponse: response,
                ...(ok ? { fiscalSentAt: () => 'now()' } : {}),
            })
            .where('id = :id', { id: paymentId })
            .execute();
    }

    // ─── audit + housekeeping ─────────────────────────────────────────────

    async logWebhook(provider: PaymentProviderKind, action: string | null, body: Json, signatureValid: boolean, response: Json): Promise<void> {
        // The audit row must never cost the provider its answer: a throw here,
        // after the wallet was credited, would make it retry or reverse.
        try {
            await this.webhookEvents.insert({ provider, action, body, signatureValid, response });
        } catch (err) {
            this.logger.error(`webhook log failed: ${err instanceof Error ? err.message : err}`);
        }
    }

    @Cron(CronExpression.EVERY_HOUR)
    async expireStalePayments(): Promise<void> {
        const result = await this.payments
            .createQueryBuilder().update()
            .set({
                status: PaymentStatus.CANCELLED, cancelledAt: () => 'now()', cancelReason: 'timeout',
                providerCancelTime: () => `(extract(epoch from now()) * 1000)::bigint`,
            })
            .where('status IN (:...open)', { open: OPEN })
            // updated_at, not created_at: Prepare bumps it, so an order the
            // provider is working on right now is never cancelled from under it.
            .andWhere(`updated_at < now() - interval '${PAYMENT_TTL_HOURS} hours'`)
            .execute();

        if (result.affected) this.logger.log(`Expired ${result.affected} stale payments`);
    }

    private assertProvider(expected: PaymentProviderKind, payment: Payment): void {
        if (payment.provider !== expected) throw new ProviderMismatchError(expected, payment.provider, payment.id);
    }
}
