import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import { FiscalStatus, PaymentProviderKind, PaymentStatus, toTiyin } from '../../billing.constants';
import { Payment } from '../../entities/payment.entity';
import { FiscalService } from '../../fiscal.service';
import { PaymentsService, ReversalNotPossibleError } from '../../payments.service';
import { PaymentProvider } from '../payment-provider';

// ─── Payme Merchant API (developer.help.paycom.uz) ────────────────────────

export const PAYME = {
    BAD_REQUEST: -32600, METHOD_NOT_FOUND: -32601, UNAUTHORIZED: -32504, SYSTEM: -32400,
    BAD_AMOUNT: -31001, TXN_NOT_FOUND: -31003, CANNOT_CANCEL: -31007, CANNOT_PERFORM: -31008,
    ORDER_NOT_FOUND: -31050, ORDER_NOT_AVAILABLE: -31051,
} as const;

const MSG: Record<number, { ru: string; uz: string; en: string }> = {
    [-32600]: { ru: 'Неверный запрос', uz: 'Noto‘g‘ri so‘rov', en: 'Invalid request' },
    [-32601]: { ru: 'Метод не найден', uz: 'Metod topilmadi', en: 'Method not found' },
    [-32504]: { ru: 'Недостаточно привилегий', uz: 'Ruxsat yo‘q', en: 'Insufficient privileges' },
    [-32400]: { ru: 'Системная ошибка', uz: 'Tizim xatosi', en: 'System error' },
    [-31001]: { ru: 'Неверная сумма', uz: 'Noto‘g‘ri summa', en: 'Incorrect amount' },
    [-31003]: { ru: 'Транзакция не найдена', uz: 'Tranzaksiya topilmadi', en: 'Transaction not found' },
    [-31007]: { ru: 'Невозможно отменить: услуга оказана', uz: 'Bekor qilib bo‘lmaydi: xizmat ko‘rsatilgan', en: 'Cannot cancel: service delivered' },
    [-31008]: { ru: 'Невозможно выполнить операцию', uz: 'Amalni bajarib bo‘lmaydi', en: 'Cannot perform operation' },
    [-31050]: { ru: 'Заказ не найден', uz: 'Buyurtma topilmadi', en: 'Order not found' },
    [-31051]: { ru: 'Заказ уже оплачен или отменён', uz: 'Buyurtma to‘langan yoki bekor qilingan', en: 'Order already paid or cancelled' },
};

export const PAYME_STATE = { CREATED: 1, PERFORMED: 2, CANCELLED: -1, CANCELLED_AFTER_PERFORM: -2 } as const;
export const PAYME_REASON_TIMEOUT = 4;
export const PAYME_TIMEOUT_MS = 43_200_000; // 12 h

// ──────────────────────────────────────────────────────────────────────────

type Rpc = { id?: unknown; method?: string; params?: Record<string, any> };
type RpcResponse = { jsonrpc: '2.0'; id: unknown; result?: unknown; error?: { code: number; message: unknown; data?: string } };

@Injectable()
export class PaymeProvider implements PaymentProvider {
    readonly kind = PaymentProviderKind.PAYME;
    private readonly logger = new Logger(PaymeProvider.name);

    constructor(
        private readonly config: ConfigService,
        private readonly payments: PaymentsService,
        private readonly fiscal: FiscalService,
    ) { }

    buildPayUrl(payment: Payment): string {
        const params = [
            `m=${this.config.getOrThrow<string>('PAYME_MERCHANT_ID')}`,
            `ac.payment_id=${payment.id}`,
            `a=${toTiyin(payment.amount)}`,
            'l=uz',
            `c=${this.config.getOrThrow<string>('PAYME_RETURN_URL')}`,
            'ct=3000',
        ].join(';');
        return `${this.config.getOrThrow<string>('PAYME_CHECKOUT_URL')}/${Buffer.from(params).toString('base64')}`;
    }

    async handleRpc(authHeader: string | undefined, body: Rpc): Promise<RpcResponse> {
        const authorized = this.authorized(authHeader);
        const id = body?.id ?? null;
        let response: RpcResponse;

        try {
            if (!authorized) response = this.error(id, PAYME.UNAUTHORIZED);
            else if (!body?.method || typeof body.params !== 'object' || body.params === null) response = this.error(id, PAYME.BAD_REQUEST);
            else response = await this.dispatch(id, body.method, body.params);
        } catch (err) {
            this.logger.error(`payme ${body?.method} crashed`, err instanceof Error ? err.stack : String(err));
            response = this.error(id, PAYME.SYSTEM);
        }

        await this.payments.logWebhook(this.kind, body?.method ?? null, (body as Record<string, unknown>) ?? {}, authorized, response);
        return response;
    }

    private dispatch(id: unknown, method: string, p: Record<string, any>): Promise<RpcResponse> {
        switch (method) {
            case 'CheckPerformTransaction': return this.checkPerform(id, p);
            case 'CreateTransaction': return this.create(id, p);
            case 'PerformTransaction': return this.perform(id, p);
            case 'CancelTransaction': return this.cancelTxn(id, p);
            case 'CheckTransaction': return this.check(id, p);
            case 'GetStatement': return this.statement(id, p);
            default: return Promise.resolve(this.error(id, PAYME.METHOD_NOT_FOUND));
        }
    }

    private async checkPerform(id: unknown, p: Record<string, any>): Promise<RpcResponse> {
        const payment = await this.payments.findByMerchantRef(this.kind, p.account?.payment_id);
        if (!payment) return this.error(id, PAYME.ORDER_NOT_FOUND, 'payment_id');
        if (payment.status !== PaymentStatus.CREATED && payment.status !== PaymentStatus.PREPARED) {
            return this.error(id, PAYME.ORDER_NOT_AVAILABLE, 'payment_id');
        }
        if (Number(p.amount) !== toTiyin(payment.amount)) return this.error(id, PAYME.BAD_AMOUNT);

        const result: Record<string, unknown> = { allow: true };
        if (this.fiscal.enabled) result.detail = this.fiscalDetail(payment);
        return this.result(id, result);
    }

    private async create(id: unknown, p: Record<string, any>): Promise<RpcResponse> {
        const txnId = String(p.id ?? '');
        if (!txnId) return this.error(id, PAYME.BAD_REQUEST);
        const existing = await this.payments.findByProviderTxn(this.kind, txnId);
        if (existing) {
            if (existing.status !== PaymentStatus.PREPARED) return this.error(id, PAYME.CANNOT_PERFORM);
            if (this.expired(existing)) {
                await this.payments.cancel(this.kind, existing, 'timeout', String(PAYME_REASON_TIMEOUT), null);
                return this.error(id, PAYME.CANNOT_PERFORM);
            }
            return this.createResult(id, existing);
        }

        const payment = await this.payments.findByMerchantRef(this.kind, p.account?.payment_id);
        if (!payment) return this.error(id, PAYME.ORDER_NOT_FOUND, 'payment_id');
        if (Number(p.amount) !== toTiyin(payment.amount)) return this.error(id, PAYME.BAD_AMOUNT);
        // Paid, cancelled, or already waiting on ANOTHER Payme transaction:
        // the order is busy (-31050..-31099), not a failed operation.
        if (payment.status !== PaymentStatus.CREATED) return this.error(id, PAYME.ORDER_NOT_AVAILABLE, 'payment_id');

        const createTime = Date.now();
        const prepared = await this.payments.markPrepared(this.kind, payment, txnId, { payme_id: txnId, payme_time: p.time }, createTime);
        if (!prepared) return this.error(id, PAYME.ORDER_NOT_AVAILABLE, 'payment_id');
        return this.createResult(id, { ...payment, providerCreateTime: String(createTime) } as Payment);
    }

    private async perform(id: unknown, p: Record<string, any>): Promise<RpcResponse> {
        const payment = await this.payments.findByProviderTxn(this.kind, String(p.id ?? ''));
        if (!payment) return this.error(id, PAYME.TXN_NOT_FOUND);
        if (payment.status === PaymentStatus.PAID) return this.performResult(id, payment);
        if (payment.status === PaymentStatus.CANCELLED) return this.error(id, PAYME.CANNOT_PERFORM);

        if (this.expired(payment)) {
            await this.payments.cancel(this.kind, payment, 'timeout', String(PAYME_REASON_TIMEOUT), null);
            return this.error(id, PAYME.CANNOT_PERFORM);
        }

        const performTime = Date.now();
        // Payme fiscalises from the detail we returned in CheckPerformTransaction
        // — only when that detail was sent, i.e. when FISCAL_* is configured.
        const paid = await this.payments.markPaid(
            this.kind, payment, payment.providerTxnId!, payment.providerPayload ?? {},
            this.fiscal.enabled ? FiscalStatus.BY_PROVIDER : FiscalStatus.NONE, performTime,
        );
        const fresh = paid
            ? ({ ...payment, providerPerformTime: String(performTime) } as Payment)
            : (await this.payments.findByProviderTxn(this.kind, payment.providerTxnId!))!;
        return this.performResult(id, fresh);
    }

    private async cancelTxn(id: unknown, p: Record<string, any>): Promise<RpcResponse> {
        const payment = await this.payments.findByProviderTxn(this.kind, String(p.id ?? ''));
        if (!payment) return this.error(id, PAYME.TXN_NOT_FOUND);
        const reason = String(p.reason ?? '');
        const cancelTime = Date.now();

        if (payment.status === PaymentStatus.CANCELLED) return this.cancelResult(id, payment);

        if (payment.status === PaymentStatus.PREPARED) {
            await this.payments.cancel(this.kind, payment, 'provider_cancel', reason, null, cancelTime);
            return this.cancelResult(id, { ...payment, status: PaymentStatus.CANCELLED, providerCancelTime: String(cancelTime), providerError: reason } as Payment);
        }

        if (payment.status === PaymentStatus.CREATED) return this.error(id, PAYME.TXN_NOT_FOUND);

        try {
            await this.payments.reverse(this.kind, payment, `payme:${reason}`, reason, cancelTime);
        } catch (err) {
            // The user already spent the money: Payme must not take it back.
            if (err instanceof ReversalNotPossibleError) return this.error(id, PAYME.CANNOT_CANCEL);
            throw err;
        }
        // Re-read: if a concurrent CancelTransaction got there first, answer
        // with ITS cancel time, not ours.
        const fresh = await this.payments.findByProviderTxn(this.kind, payment.providerTxnId!);
        return this.cancelResult(id, fresh ?? payment);
    }

    private async check(id: unknown, p: Record<string, any>): Promise<RpcResponse> {
        const payment = await this.payments.findByProviderTxn(this.kind, String(p.id ?? ''));
        if (!payment) return this.error(id, PAYME.TXN_NOT_FOUND);
        return this.result(id, this.statusOf(payment));
    }

    private async statement(id: unknown, p: Record<string, any>): Promise<RpcResponse> {
        const list = await this.payments.listByCreateTime(this.kind, Number(p.from), Number(p.to));
        return this.result(id, {
            transactions: list.map((x) => ({
                id: x.providerTxnId,
                time: Number((x.providerPayload as any)?.payme_time ?? x.providerCreateTime),
                amount: toTiyin(x.amount),
                account: { payment_id: x.id },
                ...this.statusOf(x),
                receivers: null,
            })),
        });
    }

    private statusOf(x: Payment) {
        const state =
            x.status === PaymentStatus.PAID ? PAYME_STATE.PERFORMED :
                x.status === PaymentStatus.PREPARED ? PAYME_STATE.CREATED :
                    x.providerPerformTime ? PAYME_STATE.CANCELLED_AFTER_PERFORM : PAYME_STATE.CANCELLED;
        return {
            create_time: Number(x.providerCreateTime ?? 0),
            perform_time: Number(x.providerPerformTime ?? 0),
            cancel_time: Number(x.providerCancelTime ?? 0),
            transaction: x.id,
            state,
            reason: x.status === PaymentStatus.CANCELLED && x.providerError ? Number(x.providerError) : null,
        };
    }

    /** Payme's own rule: an unperformed transaction dies after 12 hours. */
    private expired(x: Payment): boolean {
        return Date.now() - Number(x.providerCreateTime ?? 0) > PAYME_TIMEOUT_MS;
    }

    private createResult(id: unknown, x: Payment) {
        return this.result(id, { create_time: Number(x.providerCreateTime), transaction: x.id, state: PAYME_STATE.CREATED });
    }
    private performResult(id: unknown, x: Payment) {
        return this.result(id, { perform_time: Number(x.providerPerformTime), transaction: x.id, state: PAYME_STATE.PERFORMED });
    }
    private cancelResult(id: unknown, x: Payment) {
        const { cancel_time, state } = this.statusOf(x);
        return this.result(id, { cancel_time, transaction: x.id, state });
    }

    /** Payme `detail` object → the tax authority. Same line as Click, different field names. */
    private fiscalDetail(payment: Payment) {
        const line = this.fiscal.topupLine(toTiyin(payment.amount));
        return {
            receipt_type: 0,
            items: [{
                title: line.title,
                price: line.unitPriceTiyin,
                count: line.count,
                code: line.mxik,
                package_code: line.packageCode,
                vat_percent: line.vatPercent,
            }],
        };
    }

    private authorized(header: string | undefined): boolean {
        const key = this.config.get<string>('PAYME_KEY');
        if (!key || !header?.startsWith('Basic ')) return false;
        const expected = Buffer.from(`Paycom:${key}`);
        const given = Buffer.from(header.slice(6), 'base64');
        return expected.length === given.length && timingSafeEqual(expected, given);
    }

    private result(id: unknown, result: unknown): RpcResponse {
        return { jsonrpc: '2.0', id, result };
    }
    private error(id: unknown, code: number, data?: string): RpcResponse {
        this.logger.warn(`payme → ${code} ${MSG[code]?.en ?? ''}`);
        return { jsonrpc: '2.0', id, error: { code, message: MSG[code], ...(data ? { data } : {}) } };
    }
}