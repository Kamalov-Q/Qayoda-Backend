import { Injectable, Logger } from "@nestjs/common";
import { FiscalStatus, PaymentProviderKind, PaymentStatus, TOPUP_MAX, TOPUP_MIN, toTiyin } from "../../billing.constants";
import { ConfigService } from "@nestjs/config";
import { PaymentsService, ReversalNotPossibleError } from "../../payments.service";
import { WalletService } from "../../wallet.service";
import { InjectRepository } from "@nestjs/typeorm";
import { User } from "src/modules/users/entities/user.entity";
import { Repository } from 'typeorm';
import { timingSafeEqual } from "crypto";
import { UserStatus } from "src/shared/enums";
import { Payment } from "../../entities/payment.entity";

export const PAYNET = {
    // JSON-RPC level
    NOT_POST: -32300, PARSE: -32700, BAD_REQUEST: -32600, METHOD_NOT_FOUND: -32601,
    BAD_PARAMS: -32602, INTERNAL: -32603,

    //Paynet business codes
    CANNOT_CANCEL: 77, SYSTEM: 102, TXN_EXISTS: 201, TXN_CANCELLED: 202, TXN_NOT_FOUND: 203,
    CLIENT_NOT_FOUND: 302, SERVICE_NOT_FOUND: 305, MISSING_FIELDS: 411, BAD_LOGIN: 412, BAD_AMOUNT: 413,
    BAD_DATE: 414, AMOUNT_TOO_BIG: 415, PAYER_FORBIDDEN: 501, ACCESS_DENIED: 601

} as const;

const MSG: Record<number, string> = {
    [-32300]: 'Метод запроса должен быть POST',
    [-32700]: 'Ошибка парсинга JSON',
    [-32600]: 'Неверный JSON-RPC запрос',
    [-32601]: 'Запрашиваемый метод не найден',
    [-32602]: 'Отсутствуют обязательные поля параметров',
    [-32603]: 'Системная ошибка',
    77: 'Недостаточно средств на счету клиента для отмены платежа',
    102: 'Системная ошибка',
    201: 'Транзакция уже существует',
    202: 'Транзакция уже отменена',
    203: 'Транзакция не найдена',
    302: 'Клиент не найден',
    305: 'Услуга не найдена',
    411: 'Не заданы один или несколько обязательных параметров',
    412: 'Неверный логин или пароль',
    413: 'Неверная сумма',
    414: 'Неверный формат даты и времени',
    415: 'Сумма превышает максимальный лимит',
    501: 'Транзакции запрещены для данного плательщика',
    601: 'Доступ запрещен',
};



// transactionState in CheckTransaction / CancelTransaction
export const PAYNET_STATE = { SUCCESS: 1, CANCELLED: 2, NOT_FOUND: 3 } as const;

/** Contract §4.2: Paynet calls only from these networks. */
const DEFAULT_ALLOWED_IPS = '213.230.106.112/28,213.230.65.80/28';

/** Every Paynet timestamp is "YYYY-MM-DD HH:mm:ss" in Tashkent time (GMT+5, no DST). */
const TZ_OFFSET_MS = 5 * 3_600_000;
const ISO_TIME_RE = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;
const RU_TIME_RE = /^(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2}):(\d{2})$/; // CancelTransaction's example uses this one

export const toPaynetTime = (d: Date | number): string => new Date(+d + TZ_OFFSET_MS).toISOString().slice(0, 19).replace('T', ' ');

export function fromPaynetTime(s: unknown): Date | null {
    if (typeof s !== 'string') return null;
    let m = ISO_TIME_RE.exec(s);
    let y: number, mo: number, d: number, h: number, mi: number, se: number;
    if (m) [y, mo, d, h, mi, se] = m.slice(1).map(Number);
    else if ((m = RU_TIME_RE.exec(s))) [d, mo, y, h, mi, se] = m.slice(1).map(Number);
    else return null;
    const date = new Date(Date.UTC(y, mo - 1, d, h, mi, se) - TZ_OFFSET_MS);
    return Number.isNaN(date.getTime()) ? null : date;

}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACCOUNT_NO_RE = /^[1-9]\d{0,9}$/;
const TXN_ID_RE = /^[1-9]\d{0,18}$/;

/**
 * Paynet's JSON-RPC params, across every method it calls.
 *
 * `unknown` rather than `any`, and narrowed where each one is read: this is a
 * body from outside, so the type describes what MIGHT arrive, not what we
 * hope did. A DTO class is not an option — the global ValidationPipe runs
 * `forbidNonWhitelisted` and would reject Paynet's own extra fields.
 *
 *   GetInformation    serviceId, fields
 *   PerformTransaction serviceId, amount, transactionId, fields
 *   CheckTransaction  transactionId
 *   CancelTransaction transactionId
 *   GetStatement      dateFrom, dateTo
 */
interface Params {
    id?: unknown;
    jsonrpc?: unknown;
    method?: unknown;
    params?: unknown;
    serviceId?: unknown;
    amount?: unknown;
    transactionId?: unknown;
    dateFrom?: unknown;
    dateTo?: unknown;
    paynet?: unknown;
    /** The account form: field name → whatever the payer typed. */
    fields?: Record<string, unknown>;
}

/** The account fields, as `findPayer` reads them. */
type PaynetFields = Record<string, unknown>;
type RpcResponse = { jsonrpc: '2.0'; id: unknown; result?: unknown; error?: { code: number; message: string } };
export type PaynetReply = { httpStatus: number, body: RpcResponse };


@Injectable()
export class PaynetProvider {
    readonly kind = PaymentProviderKind.PAYNET;
    private readonly logger = new Logger(PaynetProvider.name);
    private readonly allowedNets: [number, number][];

    constructor(
        private readonly config: ConfigService,
        private readonly payments: PaymentsService,
        private readonly wallet: WalletService,
        @InjectRepository(User) private readonly users: Repository<User>,
    ) {
        const list = this.config.get<string>('PAYNET_ALLOWED_IPS') ?? DEFAULT_ALLOWED_IPS;
        this.allowedNets = list.trim() === '*' ? [] : list.split(',').map((c) => parseCidr(c.trim()));
    }

    get enabled(): boolean {
        return !!(this.config.get('PAYNET_SERVICE_ID') && this.config.get('PAYNET_USERNAME') && this.config.get('PAYNET_PASSWORD'));
    }

    /** The link the app opens: Paynet's page with our service, the account and the amount (so'm) filled in. */
    payUrl(accountNo: number, amountSum?: number): string {
        const base = this.config.get<string>('PAYNET_PAY_URL') ?? 'https://app.paynet.uz/';
        const params = new URLSearchParams({ m: this.config.getOrThrow<string>('PAYNET_MERCHANT_ID'), c: String(accountNo) });

        if (amountSum) params.set('a', String(amountSum));
        return `${base}?${params.toString()}`;

    }

    async handle(httpMethod: string, ip: string | undefined, authHeader: string | undefined, body: unknown): Promise<PaynetReply> {
        const rpc = (typeof body === 'object' && body !== null ? body : {}) as Params;
        const id = rpc.id ?? null;
        const method = typeof rpc.method === 'string' ? rpc.method.trim() : null;
        const authorized = this.authorized(authHeader);
        let reply: PaynetReply;

        try {
            if (!this.ipAllowed(ip)) {
                this.logger.warn(`paynet call from forbidden ip ${ip}`);
                reply = { httpStatus: 403, body: this.error(id, PAYNET.ACCESS_DENIED) };
            } else if (!authorized) {
                reply = { httpStatus: 401, body: this.error(id, PAYNET.BAD_LOGIN) };
            } else if (httpMethod !== 'POST') {
                reply = { httpStatus: 200, body: this.error(id, PAYNET.NOT_POST) };
            } else if (rpc.jsonrpc !== '2.0' || !method || typeof rpc.params !== 'object' || rpc.params === null) {
                reply = { httpStatus: 200, body: this.error(id, PAYNET.BAD_REQUEST) };
            } else {
                reply = { httpStatus: 200, body: await this.dispatch(id, method, rpc.params) };
            }
        } catch (err) {
            this.logger.error(`paynet ${method} crashed`, err instanceof Error ? err.stack : String(err));
            reply = {
                httpStatus: 200, body: this.error(id, PAYNET.SYSTEM)
            }
        }

        await this.payments.logWebhook(this.kind, method?.slice(0, 32) ?? null, rpc, authorized, reply.body);
        return reply;
    }

    private dispatch(id: unknown, method: string, p: Params): Promise<RpcResponse> {
        switch (method) {
            case 'GetInformation': return this.getInformation(id, p);
            case 'PerformTransaction': return this.perform(id, p);
            case 'CheckTransaction': return this.check(id, p);
            case 'CancelTransaction': return this.cancel(id, p);
            case 'GetStatement': return this.statement(id, p);
            default: return Promise.resolve(this.error(id, PAYNET.METHOD_NOT_FOUND));
        }
    }

    private async getInformation(id: unknown, p: Params): Promise<RpcResponse> {
        if (p.serviceId === undefined || typeof p.fields !== 'object' || p.fields === null) {
            return this.error(id, PAYNET.BAD_PARAMS);
        }
        if (!this.serviceOk(p.serviceId)) return this.error(id, PAYNET.SERVICE_NOT_FOUND);

        const found = await this.findPayer(p.fields ?? {});
        if (typeof found === 'number') return this.error(id, found);

        const balance = await this.wallet.getBalance(this.users.manager, found.id);
        return this.result(id, {
            status: 0,
            timestamp: toPaynetTime(Date.now()),
            fields: { name: maskName(found), balance: toTiyin(balance) }
        })
    }

    private async perform(id: unknown, p: Params): Promise<RpcResponse> {
        if (p.serviceId === undefined || p.amount === undefined || p.transactionId === undefined || typeof p.fields !== 'object' || p.fields === null) {
            return this.error(id, PAYNET.BAD_PARAMS);
        }

        if (!this.serviceOk(p.serviceId)) return this.error(id, PAYNET.SERVICE_NOT_FOUND);

        const txnId = txnIdOf(p.transactionId);
        if (!txnId) return this.error(id, PAYNET.BAD_PARAMS);

        const amountTiyin = Number(p.amount);
        if (!Number.isSafeInteger(amountTiyin) || amountTiyin < TOPUP_MIN * 100) return this.error(id, PAYNET.BAD_AMOUNT);
        if (amountTiyin > TOPUP_MAX * 100) return this.error(id, PAYNET.AMOUNT_TOO_BIG);

        // A retry of a transaction we already hold: say so, Paynet then asks CheckTransaction.
        if (await this.payments.findByProviderTxn(this.kind, txnId)) return this.error(id, PAYNET.TXN_EXISTS);

        const found = await this.findPayer(p.fields ?? {});
        if (typeof found === 'number') return this.error(id, found);

        const payment = await this.payments.recordPushPayment(this.kind, found.id, amountTiyin, txnId, { transactionId: txnId, fields: p.fields ?? {} }, this.fiscalStatus());
        // null = a concurrent call with the same transactionId won the insert.
        if (!payment) return this.error(id, PAYNET.TXN_EXISTS);

        return this.result(id, {
            providerTrnId: payment.prepareId,
            timestamp: toPaynetTime(payment.paidAt ?? Date.now()),
            fields: p.fields ?? {}
        })

    }

    private async check(id: unknown, p: Params): Promise<RpcResponse> {
        if (p.serviceId === undefined || p.transactionId === undefined) return this.error(id, PAYNET.BAD_PARAMS);
        if (!this.serviceOk(p.serviceId)) return this.error(id, PAYNET.SERVICE_NOT_FOUND);
        const txnId = txnIdOf(p.transactionId);
        if (!txnId) return this.error(id, PAYNET.BAD_PARAMS);

        const payment = await this.payments.findByProviderTxn(this.kind, txnId);

        if (!payment) {
            return this.result(id, { transactionState: PAYNET_STATE.NOT_FOUND, timestamp: toPaynetTime(Date.now()), providerTrnId: 0 });
        }

        return this.result(id, this.stateOf(payment));
    }

    private async cancel(id: unknown, p: Params): Promise<RpcResponse> {
        if (p.serviceId === undefined || p.transactionId === undefined) return this.error(id, PAYNET.BAD_PARAMS);
        if (!this.serviceOk(p.serviceId)) return this.error(id, PAYNET.SERVICE_NOT_FOUND);
        const txnId = txnIdOf(p.transactionId);
        if (!txnId) return this.error(id, PAYNET.BAD_PARAMS);

        const payment = await this.payments.findByProviderTxn(this.kind, txnId);
        if (!payment) return this.error(id, PAYNET.TXN_NOT_FOUND);
        if (payment.status === PaymentStatus.CANCELLED) return this.error(id, PAYNET.TXN_CANCELLED);

        try {
            const reversed = await this.payments.reverse(this.kind, payment, 'paynet:cancel', null);
            // false = a concurrent CancelTransaction got there first
            if (!reversed) return this.error(id, PAYNET.TXN_CANCELLED);
        }
        catch (err) {
            // The user already spent the money: Paynet must not take it back.
            if (err instanceof ReversalNotPossibleError) return this.error(id, PAYNET.CANNOT_CANCEL);
            throw err;
        }

        const fresh = await this.payments.findByProviderTxn(this.kind, txnId);
        return this.result(id, this.stateOf(fresh ?? payment));

    }

    private async statement(id: unknown, p: Params): Promise<RpcResponse> {
        if (p.serviceId === undefined || p.dateFrom === undefined || p.dateTo === undefined)
            return this.error(id, PAYNET.BAD_PARAMS);
        if (!this.serviceOk(p.serviceId)) return this.error(id, PAYNET.SERVICE_NOT_FOUND);

        const from = fromPaynetTime(p.dateFrom);
        const to = fromPaynetTime(p.dateTo);
        if (!from || !to || from > to) return this.error(id, PAYNET.BAD_DATE);

        // Reconciliation: only money that is ours — cancelled ones are not in the register.
        const list = await this.payments.listPaidBetween(this.kind, from, to);
        return this.result(id, {
            statements: list.map((x) => ({
                amount: toTiyin(x.amount),
                providerTrnId: x.prepareId,
                transactionId: Number(x.providerTxnId),
                timestamp: toPaynetTime(x.paidAt!),
            }))
        })

    }

    // ─── helpers ──────────────────────────────────────────────────────────

    /** Who sends the receipt to soliq. Until Paynet confirms, nobody: NONE. */
    private fiscalStatus(): FiscalStatus.BY_PROVIDER | FiscalStatus.NONE {
        return this.config.get<string>('PAYNET_FISCAL') === 'BY_PROVIDER' ? FiscalStatus.BY_PROVIDER : FiscalStatus.NONE;
    }


    private stateOf(x: Payment) {
        const cancelled = x.status === PaymentStatus.CANCELLED;
        return {
            providerTrnId: x.prepareId,
            timestamp: toPaynetTime((cancelled ? x.cancelledAt : x.paidAt) ?? x.updatedAt),
            transactionState: cancelled ? PAYNET_STATE.CANCELLED : PAYNET_STATE.SUCCESS
        }
    }

    private async findPayer(fields: PaynetFields): Promise<User | number> {
        const raw = fields[this.config.get<string>('PAYNET_ACCOUNT_FIELD') ?? 'client_id'];
        // Only a string or a number is an account reference. Anything else —
        // an object, an array — is a malformed request, not something to
        // stringify into "[object Object]" and then fail to find.
        if (typeof raw !== 'string' && typeof raw !== 'number') return PAYNET.MISSING_FIELDS;
        const ref = String(raw).trim();
        if (!ref) return PAYNET.MISSING_FIELDS;

        let user: User | null = null;
        if (ACCOUNT_NO_RE.test(ref)) user = await this.users.findOne({ where: { accountNo: Number(ref) } });
        else if (UUID_RE.test(ref)) user = await this.users.findOne({ where: { id: ref } });

        if (!user) return PAYNET.CLIENT_NOT_FOUND;
        if (user.status === UserStatus.BANNED) return PAYNET.PAYER_FORBIDDEN;
        return user;
    }

    private serviceOk(serviceId: unknown): boolean {
        return String(serviceId) === this.config.get<string>('PAYNET_SERVICE_ID');
    }

    private authorized(header: string | undefined): boolean {
        const user = this.config.get<string>('PAYNET_USERNAME');
        const pass = this.config.get<string>('PAYNET_PASSWORD');
        if (!user || !pass || !header?.startsWith('Basic ')) return false;
        const expected = Buffer.from(`${user}:${pass}`);
        const given = Buffer.from(header.slice(6).trim(), 'base64');
        return expected.length === given.length && timingSafeEqual(expected, given);
    }

    private ipAllowed(ip: string | undefined): boolean {
        if (this.allowedNets.length === 0) return true; // PAYNET_ALLOWED_IPS=* (local testing only)
        const n = ipv4ToInt(ip?.replace(/^::ffff:/, ''));
        return n !== null && this.allowedNets.some(([net, mask]) => (n & mask) >>> 0 === net);
    }

    private result(id: unknown, result: unknown): RpcResponse {
        return { jsonrpc: '2.0', id, result };
    }

    private error(id: unknown, code: number): RpcResponse {
        this.logger.warn(`paynet -> ${code} ${MSG[code] ?? ''}`);
        return { jsonrpc: '2.0', id, error: { code, message: MSG[code] ?? 'Error' } };
    }

}


/** Shown to whoever types an account number into Paynet: enough to confirm, not a full name. */
function maskName(u: User): string {
    const first = u.name?.trim();
    const last = u.surname?.trim();
    if (!first && !last) return '-';
    return [first, last ? `${last[0]}.` : null].filter(Boolean).join(' ');
}


function txnIdOf(v: unknown): string | null {
    const s = typeof v === 'number' ? (Number.isSafeInteger(v) ? String(v) : '') : typeof v === 'string' ? v.trim() : '';
    return TXN_ID_RE.test(s) ? s : null;
}

function ipv4ToInt(ip: string | undefined): number | null {
    const parts = ip?.split('.');
    if (!parts || parts.length !== 4) return null;
    let n = 0;
    for (const part of parts) {
        const o = Number(part);
        if (!/^\d{1,3}$/.test(part) || o > 255) return null;
        n = n * 256 + o;
    }
    return n;
}

function parseCidr(cidr: string): [number, number] {
    const [base, bits = '32'] = cidr.split('/');
    const n = ipv4ToInt(base);
    const b = Number(bits);
    if (n === null || !Number.isInteger(b) || b < 0 || b > 32) throw new Error(`PAYNET_ALLOWED_IPS: bad entry "${cidr}"`);
    const mask = b === 0 ? 0 : (0xffffffff << (32 - b)) >>> 0;
    return [(n & mask) >>> 0, mask];
}


