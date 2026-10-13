# Paynet — business logic, workflow and implementation

Written for whoever implements or maintains Paynet top-ups in this codebase.
Based on Paynet's "Спецификация универсального WEB-сервиса поставщика услуг"
(JSON-RPC 2.0, v1.0) and Appendix №2 to contract №S-2075 of 17.12.2025.

**Status of the code below:** it typechecks against the whole server
(`tsc --noEmit` clean), and the handler was exercised with mocked dependencies
for all methods and error cases — every answer matched the spec. It has NOT
yet been run against a real database (the payment INSERT, the `account_no`
migration) or behind the production nginx (`trust proxy`).

**Still to confirm with Paynet:** the `serviceId`, the key name inside
`params.fields` (assumed `client_id`), and who issues the fiscal receipt.

---

## 1. The idea in one paragraph

Paynet is the opposite of Click and Payme. With those, **your app creates an
order** and the provider pays it. With Paynet **there is no order beforehand**:
the user tells Paynet "put money into account 88218", and Paynet calls your
server to look the account up and credit it. This is called a *push* model.

## 2. The parties

| Party | Role |
|---|---|
| **User** | Pays from the Paynet app, the paynet.uz website, a kiosk, or an agent's counter. |
| **Paynet** | Takes the user's money and calls your server. |
| **Your server** ("Поставщик", provider) | Answers Paynet's calls: confirms the account, credits the wallet, reports status. |
| **Your app** | Opens the Paynet link and shows the user their account number. |

## 3. The full flow

```
 USER / APP                   PAYNET                         YOUR SERVER
 ──────────                   ──────                         ───────────
 1. Taps "Paynet", 50 000
    App: GET /api/wallet/paynet-link?amount=50000  ───────────▶
    ◀─────────── { accountNo: 88218, payUrl: app.paynet.uz/?m=52589&c=88218&a=50000 }

 2. Opens payUrl ─────────▶  Shows: Hisob raqami 88218,
                             50 000 so'm
                             (or the user types 88218 at a kiosk)

 3.                          GetInformation {client_id: 88218} ──▶  find user 88218
                             ◀──────────────────────────────────── { name: "Ivan P.", balance }
                             The user sees "Ivan P." and confirms it's them

 4. Pays with card/cash ──▶  Paynet takes the money

 5.                          PerformTransaction                ──▶  • transactionId already seen? → 201
                             {transactionId: 12345678900,           • find user, check amount
                              amount: 5000000 (tiyin),              • ONE DB transaction:
                              fields: {client_id: 88218}}             insert payment (PAID)
                                                                      + credit wallet + bonus
                             ◀──────────────────────────────────── { providerTrnId: 7, timestamp }

 6. Back in the app, the balance is higher (the PAYMENT_PAID event can push a notification)

 Later, as needed:
                             CheckTransaction                  ──▶  1 paid / 2 cancelled / 3 not found
                             CancelTransaction                 ──▶  take the money back if not yet spent
 Every day:
                             GetStatement {dateFrom, dateTo}   ──▶  list of every paid transaction
```

### The app link

Paynet confirmed the format: `https://app.paynet.uz/?m=52589&c=<account>&a=<amount>`

- `m` — our merchant/service id in Paynet (`52589`).
- `c` — the account number. Paynet shows it as **"Hisob raqami"**. Use the
  short numeric `account_no`, not the user's UUID: users must be able to read
  and type it (Paynet app, kiosk), and Paynet displays it.
- `a` — amount in **so'm** (`a=50000` shows as "50 000 so'm"). Note that
  `PerformTransaction` later sends the amount in **tiyin** (`5000000`).

## 4. What each method means

### 4.1 GetInformation — "Does this account exist?"
- Paynet calls it before taking money, so the user sees they are paying the right person.
- Return a masked name ("Ivan P.") and the balance. Mask it: anyone can type any number into Paynet.
- No such account → `302`. Paynet will not take the money.

### 4.2 PerformTransaction — "I took the money, credit it."
The only method that moves money.
- **Idempotent on `transactionId`.** Paynet retries on network failures; the same
  `transactionId` must never credit twice. A second call gets `201`
  "Транзакция уже существует". The unique DB index on
  `(provider, provider_txn_id)` guarantees this even if two requests arrive at
  the same moment.
- **Atomic.** Inserting the payment and crediting the wallet (plus the tier
  bonus) happen in one DB transaction: both or neither.
- **Amounts are in tiyin.** 50 000 so'm arrives as `5000000`.
- **The response is the receipt.** Paynet treats the payment as successful only
  once it gets your answer. If you crash before answering, Paynet does not know
  whether the money landed, so it calls `CheckTransaction`.

### 4.3 CheckTransaction — "What happened to my transaction?"
- Used when `PerformTransaction` timed out, or to confirm state.
- `1` paid, `2` cancelled, `3` never received. On `3` Paynet treats the payment
  as failed and refunds the user on its side.

### 4.4 CancelTransaction — "Give the money back."
- Paynet asks for it when it refunds: card chargeback, operator error.
- Take amount + bonus back out of the wallet. If the user already spent it
  (balance too low) → `77`, nothing is cancelled. Same rule as the Payme code.
- Already cancelled → `202`; unknown transaction → `203`.

### 4.5 GetStatement — daily reconciliation
- Every day Paynet asks "what did you receive between X and Y?" and compares
  with its own register (contract §5). Paynet also emails its register.
- Return only payments that are still PAID; cancelled ones are not in Paynet's
  register either.
- On a mismatch someone investigates — that is why each payment stores
  Paynet's `transactionId`.

### 4.6 ChangePassword
Optional. Not implemented (answers `-32601`); the password is agreed with
Paynet directly and lives in `.env`.

## 5. Payment states

```
            PerformTransaction                CancelTransaction
  (none) ──────────────────────▶  PAID  ──────────────────────▶  CANCELLED
                                   │        (only if the wallet
                                   │         still covers it)
                                   └── otherwise error 77, stays PAID
```

Click and Payme go `CREATED → PREPARED → PAID`. Paynet skips both: the row is
born PAID, because when Paynet calls, the money is already taken. So the
hourly `expireStalePayments` cron never touches Paynet rows.

## 6. Rules from the contract

| Rule | Where it's enforced |
|---|---|
| Calls only from `213.230.106.112/28` and `213.230.65.80/28` (§4.2–4.3) | IP check → `601` (HTTP 403) |
| HTTP Basic auth; wrong/missing login must return **HTTP 401** (spec §2.2) | `authorized()` |
| JSON-RPC 2.0, POST only, UTF-8 | `-32300`, `-32600`, `-32700` |
| Answer within 500 ms, never over 30 s (§4.5–4.6, else disconnection) | `PerformTransaction` = a few queries, no external calls |
| Timestamps `YYYY-MM-DD HH:mm:ss`, GMT+5 | `toPaynetTime()` / `fromPaynetTime()` (also accepts `dd.MM.yyyy HH:mm:ss`) |
| Notify Paynet 2 weeks before planned maintenance; immediately on outages (§7) | Process, not code |

### Error codes used

| Code | When |
|---|---|
| `-32300` | Request method is not POST |
| `-32700` | Malformed JSON |
| `-32600` | Not a JSON-RPC 2.0 request |
| `-32601` | Unknown method (incl. ChangePassword) |
| `-32602` | Required params missing |
| `77` | Cancel refused: user already spent the money |
| `102` | Unexpected server error |
| `201` | `transactionId` already exists |
| `202` | Transaction already cancelled |
| `203` | Transaction not found (cancel) |
| `302` | Account not found |
| `305` | Wrong `serviceId` |
| `411` | Account field missing in `fields` |
| `412` | Wrong login/password (with HTTP 401) |
| `413` | Amount invalid or below minimum |
| `414` | Bad date in GetStatement |
| `415` | Amount above maximum |
| `501` | User is banned |
| `601` | Caller IP not allowed (with HTTP 403) |

## 7. How the code is organised

```
providers/paynet/paynet.controller.ts          ALL /api/paynet → method, IP, auth header, body → provider
providers/paynet/paynet.provider.ts            checks (IP → auth → JSON-RPC shape) → 5 methods
providers/paynet/paynet-parse-error.filter.ts  malformed JSON → JSON-RPC -32700 instead of Nest's 400
payments.service.ts   recordPushPayment()      insert PAID + credit wallet, one DB transaction
                      listPaidBetween()        for GetStatement
                      reverse()                existing, reused for CancelTransaction
users.account_no                               the short number Paynet shows as "Hisob raqami"
wallet controller     GET /wallet/paynet-link  the URL the app opens
main.ts                                        trust proxy + global parse-error filter
```

## 8. Implementation order

1. **Database:** run `sql/2026-10-13-paynet.sql` (§9.4) so every user gets an `account_no`.
2. **Backend:** add the three new files (§9.1–9.3), apply the changes in §9.5, set the `.env` values (§9.6).
3. **Test locally:** set `PAYNET_ALLOWED_IPS=*` and use the `curl` calls in §10. Check the 401, `201` duplicate, `302` and `77` cases.
4. **Mobile:** call `GET /api/wallet/paynet-link?amount=…` and open `payUrl`, instead of building the link from `user.id` and the hardcoded `52589` (`mobile/app/wallet/index.tsx`). Show `accountNo` from `GET /api/wallet` on the balance card.
5. **Paynet:**
   - give them the URL `https://<domain>/api/paynet` and the username + password;
   - get the `serviceId` and confirm the `fields` key name;
   - ask who issues fiscal receipts (code currently saves `FiscalStatus.NONE`).
6. **Paynet's test run:** they call every method from their test environment. Watch the `payment_webhook_events` table — every call and your answer is logged there.
7. **Production:** remove `PAYNET_ALLOWED_IPS=*`; confirm `trust proxy` matches your nginx setup (`'loopback'` is only right when nginx runs on the same machine); go live.

---

## 9. Code

### 9.1 New: `src/modules/billing/providers/paynet/paynet.provider.ts`

```ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { timingSafeEqual } from 'crypto';
import { Repository } from 'typeorm';
import { UserStatus } from 'src/shared/enums';
import { User } from '../../../users/entities/user.entity';
import { FiscalStatus, PaymentProviderKind, PaymentStatus, toTiyin, TOPUP_MAX, TOPUP_MIN } from '../../billing.constants';
import { Payment } from '../../entities/payment.entity';
import { PaymentsService, ReversalNotPossibleError } from '../../payments.service';
import { WalletService } from '../../wallet.service';

// ─── Paynet universal provider web service (JSON-RPC 2.0) ─────────────────

export const PAYNET = {
    // JSON-RPC level
    NOT_POST: -32300, PARSE: -32700, BAD_REQUEST: -32600, METHOD_NOT_FOUND: -32601, BAD_PARAMS: -32602, INTERNAL: -32603,
    // Paynet business codes
    CANNOT_CANCEL: 77, SYSTEM: 102, TXN_EXISTS: 201, TXN_CANCELLED: 202, TXN_NOT_FOUND: 203,
    CLIENT_NOT_FOUND: 302, SERVICE_NOT_FOUND: 305, MISSING_FIELDS: 411, BAD_LOGIN: 412, BAD_AMOUNT: 413,
    BAD_DATE: 414, AMOUNT_TOO_BIG: 415, PAYER_FORBIDDEN: 501, ACCESS_DENIED: 601,
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

/** transactionState in CheckTransaction / CancelTransaction. */
export const PAYNET_STATE = { SUCCESS: 1, CANCELLED: 2, NOT_FOUND: 3 } as const;

/** Contract §4.2: Paynet calls only from these networks. */
const DEFAULT_ALLOWED_IPS = '213.230.106.112/28,213.230.65.80/28';

/** Every Paynet timestamp is "YYYY-MM-DD HH:mm:ss" in Tashkent time (GMT+5, no DST). */
const TZ_OFFSET_MS = 5 * 3_600_000;
const ISO_TIME_RE = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;
const RU_TIME_RE = /^(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2}):(\d{2})$/; // CancelTransaction's example uses this one

export const toPaynetTime = (d: Date | number): string =>
    new Date(+d + TZ_OFFSET_MS).toISOString().slice(0, 19).replace('T', ' ');

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

// ──────────────────────────────────────────────────────────────────────────

type Params = Record<string, any>;
type RpcResponse = { jsonrpc: '2.0'; id: unknown; result?: unknown; error?: { code: number; message: string } };
export type PaynetReply = { httpStatus: number; body: RpcResponse };

/**
 * Paynet is PUSH-model: no order exists before the money arrives. The payer
 * gives Paynet an account number (users.account_no, or the user's UUID from
 * older app links); Paynet looks it up with GetInformation, then credits it
 * with PerformTransaction — which creates the Payment row already PAID.
 */
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
                // Spec §2.2: missing or wrong credentials MUST be HTTP 401.
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
            reply = { httpStatus: 200, body: this.error(id, PAYNET.SYSTEM) };
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
            // ChangePassword is optional; the password is agreed out of band and lives in env.
            default: return Promise.resolve(this.error(id, PAYNET.METHOD_NOT_FOUND));
        }
    }

    private async getInformation(id: unknown, p: Params): Promise<RpcResponse> {
        if (p.serviceId === undefined || typeof p.fields !== 'object' || p.fields === null) return this.error(id, PAYNET.BAD_PARAMS);
        if (!this.serviceOk(p.serviceId)) return this.error(id, PAYNET.SERVICE_NOT_FOUND);

        const found = await this.findPayer(p.fields);
        if (typeof found === 'number') return this.error(id, found);

        const balance = await this.wallet.getBalance(this.users.manager, found.id);
        return this.result(id, {
            status: 0,
            timestamp: toPaynetTime(Date.now()),
            fields: { name: maskName(found), balance: toTiyin(balance) },
        });
    }

    private async perform(id: unknown, p: Params): Promise<RpcResponse> {
        if (p.serviceId === undefined || p.amount === undefined || p.transactionId === undefined
            || typeof p.fields !== 'object' || p.fields === null) {
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

        const found = await this.findPayer(p.fields);
        if (typeof found === 'number') return this.error(id, found);

        const payment = await this.payments.recordPushPayment(
            this.kind, found.id, amountTiyin, txnId, { transactionId: txnId, fields: p.fields }, FiscalStatus.NONE,
        );
        // null = a concurrent call with the same transactionId won the insert.
        if (!payment) return this.error(id, PAYNET.TXN_EXISTS);

        return this.result(id, {
            providerTrnId: payment.prepareId,
            timestamp: toPaynetTime(payment.paidAt ?? Date.now()),
            fields: p.fields,
        });
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
            // false = a concurrent CancelTransaction got there first.
            if (!reversed) return this.error(id, PAYNET.TXN_CANCELLED);
        } catch (err) {
            // The user already spent the money: Paynet must not take it back.
            if (err instanceof ReversalNotPossibleError) return this.error(id, PAYNET.CANNOT_CANCEL);
            throw err;
        }

        const fresh = await this.payments.findByProviderTxn(this.kind, txnId);
        return this.result(id, this.stateOf(fresh ?? payment));
    }

    private async statement(id: unknown, p: Params): Promise<RpcResponse> {
        if (p.serviceId === undefined || p.dateFrom === undefined || p.dateTo === undefined) return this.error(id, PAYNET.BAD_PARAMS);
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
            })),
        });
    }

    // ─── helpers ──────────────────────────────────────────────────────────

    private stateOf(x: Payment) {
        const cancelled = x.status === PaymentStatus.CANCELLED;
        return {
            providerTrnId: x.prepareId,
            timestamp: toPaynetTime((cancelled ? x.cancelledAt : x.paidAt) ?? x.updatedAt),
            transactionState: cancelled ? PAYNET_STATE.CANCELLED : PAYNET_STATE.SUCCESS,
        };
    }

    /** The account the payer named, or the Paynet error code saying why not. */
    private async findPayer(fields: Params): Promise<User | number> {
        const raw = fields[this.config.get<string>('PAYNET_ACCOUNT_FIELD') ?? 'client_id'];
        if (raw === undefined || raw === null || raw === '') return PAYNET.MISSING_FIELDS;
        const ref = String(raw).trim();

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
        this.logger.warn(`paynet → ${code} ${MSG[code] ?? ''}`);
        return { jsonrpc: '2.0', id, error: { code, message: MSG[code] ?? 'Ошибка' } };
    }
}

/** Shown to whoever types an account number into Paynet: enough to confirm, not a full name. */
function maskName(u: User): string {
    const first = u.name?.trim();
    const last = u.surname?.trim();
    if (!first && !last) return '—';
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
```

### 9.2 New: `src/modules/billing/providers/paynet/paynet.controller.ts`

```ts
import { All, Body, Controller, Headers, Req, Res } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { SkipThrottle } from "@nestjs/throttler";
import type { Request, Response } from "express";
import { PaynetProvider } from "./paynet.provider";

@ApiExcludeController()
@SkipThrottle()
@Controller('paynet')
export class PaynetWebhookController {
    constructor(private readonly paynet: PaynetProvider) { }

    // @All, not @Post: a non-POST call must get JSON-RPC -32300, not Nest's 404.
    @All()
    async rpc(
        @Req() req: Request,
        @Res({ passthrough: true }) res: Response,
        @Headers('authorization') auth: string | undefined,
        @Body() body: Record<string, unknown>,
    ) {
        const reply = await this.paynet.handle(req.method, req.ip, auth, body);
        res.status(reply.httpStatus);
        return reply.body;
    }
}
```

### 9.3 New: `src/modules/billing/providers/paynet/paynet-parse-error.filter.ts`

Malformed JSON fails in the body parser before routing, so only a **global** filter can catch it (verified with a test app).

```ts
import { ArgumentsHost, Catch, HttpException } from "@nestjs/common";
import { BaseExceptionFilter } from "@nestjs/core";
import type { Request, Response } from "express";
import { PAYNET } from "./paynet.provider";

/**
 * Malformed JSON fails in the body parser, before any route — so only a GLOBAL
 * filter sees it. On the Paynet path it must still be a JSON-RPC answer
 * (-32700), not Nest's {statusCode: 400}. Everything else passes through.
 */
@Catch()
export class PaynetParseErrorFilter extends BaseExceptionFilter {
    catch(exception: unknown, host: ArgumentsHost) {
        const http = host.switchToHttp();
        const req = http.getRequest<Request | undefined>();
        if (host.getType() !== 'http' || !req?.path?.startsWith('/api/paynet')) return super.catch(exception, host);

        const status = exception instanceof HttpException ? exception.getStatus() : 500;
        const code = status === 400 ? PAYNET.PARSE : status < 500 ? PAYNET.BAD_REQUEST : PAYNET.INTERNAL;
        http.getResponse<Response>().status(200).json({ jsonrpc: '2.0', id: null, error: { code, message: code === PAYNET.PARSE ? 'Ошибка парсинга JSON' : 'Неверный JSON-RPC запрос' } });
    }
}
```

### 9.4 New: `sql/2026-10-13-paynet.sql`

```sql
-- Paynet as a third top-up provider (push model: Paynet pays an ACCOUNT).
-- Run AFTER 2026-10-10-payme-fiscal.sql. Idempotent: safe to run twice.
--
--   users.account_no   short public number ("Hisob raqami") the payer gives Paynet
--
-- Index name matches src/modules/users/entities/user.entity.ts.

BEGIN;

CREATE SEQUENCE IF NOT EXISTS users_account_no_seq START 10001;
ALTER TABLE users ADD COLUMN IF NOT EXISTS account_no int;
UPDATE users SET account_no = nextval('users_account_no_seq') WHERE account_no IS NULL;
ALTER TABLE users ALTER COLUMN account_no SET DEFAULT nextval('users_account_no_seq');
ALTER TABLE users ALTER COLUMN account_no SET NOT NULL;
ALTER SEQUENCE users_account_no_seq OWNED BY users.account_no;
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_account_no ON users (account_no);

-- GetStatement (Paynet) lists paid transactions by paid_at.
CREATE INDEX IF NOT EXISTS "IDX_payments_provider_paid_at" ON payments (provider, paid_at);

COMMIT;
```

### 9.5 Changes to existing files

Unified diff against the current code: `payments.service.ts`, `user.entity.ts`, `billing.module.ts`, `wallet.service.ts`, `billing.controller.ts`, `dto/billing.dto.ts`, `main.ts`.

```diff
--- a/src/modules/billing/payments.service.ts
+++ b/src/modules/billing/payments.service.ts
@@ -74,6 +74,16 @@
             .getMany();
     }
 
+    /** Paynet reconciliation (GetStatement): the money we kept, by when it arrived. */
+    listPaidBetween(provider: PaymentProviderKind, from: Date, to: Date): Promise<Payment[]> {
+        return this.payments
+            .createQueryBuilder('p')
+            .where('p.provider = :provider AND p.status = :paid', { provider, paid: PaymentStatus.PAID })
+            .andWhere('p.paidAt BETWEEN :from AND :to', { from, to })
+            .orderBy('p.paidAt', 'ASC')
+            .getMany();
+    }
+
     /**
      * Receipts still owed: PENDING ones, plus SENDING claims a crashed submit
      * left behind. FAILED is NOT retried — it has used up its attempts and is
@@ -174,6 +184,51 @@
         return true;
     }
 
+    /**
+     * A PUSH-model top-up (Paynet): the provider pays an account, not an order
+     * we made, so the row is born PAID. Insert + wallet credit are ONE
+     * transaction; the unique (provider, provider_txn_id) index decides a
+     * duplicate — the loser inserts nothing and gets null.
+     */
+    async recordPushPayment(
+        provider: PaymentProviderKind, userId: string, amountTiyin: number, providerTxnId: string, payload: Json,
+        fiscal: FiscalStatus.PENDING | FiscalStatus.BY_PROVIDER | FiscalStatus.NONE,
+    ): Promise<Payment | null> {
+        const amount = fromTiyin(amountTiyin);
+
+        const outcome = await this.dataSource.transaction(async (manager) => {
+            const bonus = await this.wallet.bonusFor(manager, amountTiyin);
+            const bonusAmount = fromTiyin(bonus.bonusTiyin);
+            const now = String(Date.now());
+
+            const rows: { id: string }[] = await manager.query(
+                `INSERT INTO payments (user_id, provider, amount, bonus_amount, status, provider_txn_id, provider_payload,
+                                       provider_create_time, provider_perform_time, fiscal_status, paid_at)
+                 VALUES ($1, $2, $3, $4, 'PAID', $5, $6::jsonb, $7, $7, $8, now())
+                 ON CONFLICT (provider, provider_txn_id) WHERE provider_txn_id IS NOT NULL DO NOTHING
+                 RETURNING id`,
+                [userId, provider, amount, bonusAmount, providerTxnId, JSON.stringify(payload), now, fiscal],
+            );
+            if (rows.length === 0) return null;
+            const paymentId = rows[0].id;
+
+            let balance = await this.wallet.credit(manager, userId, amountTiyin, TxKind.TOPUP, paymentId, `${provider} ${providerTxnId}`);
+            if (bonus.bonusTiyin > 0) {
+                balance = await this.wallet.credit(manager, userId, bonus.bonusTiyin, TxKind.TOPUP_BONUS, paymentId, `${provider} +${bonus.percent}% bonus`);
+            }
+            return { paymentId, bonusAmount, balance };
+        });
+
+        if (!outcome) return null;
+
+        this.logger.log(`Payment ${outcome.paymentId} PAID via ${provider}: ${amount} + ${outcome.bonusAmount} bonus`);
+        this.events.emit(
+            BILLING_EVENTS.PAYMENT_PAID,
+            new PaymentPaidEvent(outcome.paymentId, userId, provider, amount, outcome.bonusAmount, outcome.balance),
+        );
+        return this.payments.findOneOrFail({ where: { id: outcome.paymentId } });
+    }
+
     async cancel(
         provider: PaymentProviderKind, payment: Payment, reason: string,
         providerError: string | null,
--- a/src/modules/users/entities/user.entity.ts
+++ b/src/modules/users/entities/user.entity.ts
@@ -34,6 +34,14 @@
   avatarThumbUrl: string | null;
 
   /**
+   * Short public account number ("Hisob raqami"): what the user types into
+   * Paynet, and what the app's Paynet link carries. Never reused.
+   */
+  @Index('uq_users_account_no', { unique: true })
+  @Column({ name: 'account_no', type: 'int', generated: 'increment' })
+  accountNo: number;
+
+  /**
    * Set only by a verified channel — an SMS OTP the user passed, or a phone a
    * provider vouched for. Never writable from the profile endpoint: a user who
    * could type in someone else's number would be handed their account the next
--- a/src/modules/billing/billing.module.ts
+++ b/src/modules/billing/billing.module.ts
@@ -23,13 +23,15 @@
 import { FiscalService } from './fiscal.service';
 import { ClickFiscalService } from './providers/click/click-fiscal.service';
 import { BillingEventsListener } from './billing-events.listener';
+import { PaynetProvider } from './providers/paynet/paynet.provider';
+import { PaynetWebhookController } from './providers/paynet/paynet.controller';
 
 @Module({
     imports: [
         AuthModule,
         TypeOrmModule.forFeature([Wallet, WalletTransaction, Payment, PaymentWebhookEvent, Tariff, BonusTier, User]),
     ],
-    controllers: [WalletController, ClickWebhookController, PaymeWebhookController, BillingAdminController],
+    controllers: [WalletController, ClickWebhookController, PaymeWebhookController, PaynetWebhookController, BillingAdminController],
     providers: [
         WalletService,
         PaymentsService,
@@ -39,6 +41,7 @@
         ClickProvider,
         ClickFiscalService,
         PaymeProvider,
+        PaynetProvider,
         BillingEventsListener,
         // What the app may offer: a provider without its credentials would
         // hand out checkout links that cannot work, so it is left out.
--- a/src/modules/billing/wallet.service.ts
+++ b/src/modules/billing/wallet.service.ts
@@ -21,13 +21,15 @@
 
     async overview(userId: string) {
         const balance = await this.getBalance(this.dataSource.manager, userId);
-        const [tariffs, bonusTiers] = await Promise.all([
+        const [user, tariffs, bonusTiers] = await Promise.all([
+            this.dataSource.manager.findOneOrFail(User, { where: { id: userId }, select: { id: true, accountNo: true } }),
             this.tariffs.find({ where: { isActive: true }, order: { action: 'ASC', price: 'ASC' } }),
             this.tiers.find({ where: { isActive: true }, order: { minAmount: 'ASC' } })
         ]);
 
         return {
             balance,
+            accountNo: user.accountNo,
             tariffs: tariffs.map((t) => ({
                 id: t.id, action: t.action, nameUz: t.nameUz, nameRu: t.nameRu, price: t.price, durationDays: t.durationDays,
             })),
--- a/src/modules/billing/billing.controller.ts
+++ b/src/modules/billing/billing.controller.ts
@@ -1,11 +1,13 @@
-import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from "@nestjs/common";
+import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from "@nestjs/common";
 import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
 import { JwtAccessGuard } from "../auth/guards/jwt-access.guard";
 import { WalletService } from "./wallet.service";
 import { TopupService } from "./topup.service";
 import { CurrentUser } from "../auth/decorators/current-user.decorator";
 import type { AuthUser } from "../auth/types/auth-user.type";
-import { PageQueryDto, TopupDto } from "./dto/billing.dto";
+import { PageQueryDto, PaynetLinkQueryDto, TopupDto } from "./dto/billing.dto";
+import { PaynetProvider } from "./providers/paynet/paynet.provider";
+import { PaymentProviderKind } from "./billing.constants";
 import { PhoneRequiredGuard } from "../auth/guards/phone-required.guard";
 
 @ApiTags('wallet')
@@ -15,13 +17,16 @@
 export class WalletController {
     constructor(
         private readonly wallet: WalletService,
-        private readonly topup: TopupService
+        private readonly topup: TopupService,
+        private readonly paynet: PaynetProvider,
     ) { }
 
     @Get()
     async overview(@CurrentUser() user: AuthUser) {
         const data = await this.wallet.overview(user.sub);
-        return { ...data, providers: this.topup.availableProviders() }
+        // Paynet is push-model: no order to create, so it is not in TopupService.
+        const providers = [...this.topup.availableProviders(), ...(this.paynet.enabled ? [PaymentProviderKind.PAYNET] : [])];
+        return { ...data, providers }
     }
 
     @Get('transactions')
@@ -35,6 +40,14 @@
         return this.topup.createTopup(user.sub, dto.amount, dto.provider, dto.clientId);
     }
 
+    /** Paynet checkout link for this user's account number; the app opens it. */
+    @Get('paynet-link')
+    async paynetLink(@CurrentUser() user: AuthUser, @Query() q: PaynetLinkQueryDto) {
+        if (!this.paynet.enabled) throw new BadRequestException({ code: 'PROVIDER_UNAVAILABLE', message: 'PAYNET is not enabled' });
+        const { accountNo } = await this.wallet.overview(user.sub);
+        return { accountNo, payUrl: this.paynet.payUrl(accountNo, q.amount) };
+    }
+
     @Get('topup/:id')
     topupStatus(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
         return this.topup.getTopup(user.sub, id);
--- a/src/modules/billing/dto/billing.dto.ts
+++ b/src/modules/billing/dto/billing.dto.ts
@@ -26,6 +26,16 @@
 
 }
 
+export class PaynetLinkQueryDto {
+    @ApiPropertyOptional({ example: 50000, description: "so'm; omitted = the payer types it in Paynet" })
+    @IsOptional()
+    @Type(() => Number)
+    @IsInt()
+    @Min(TOPUP_MIN)
+    @Max(TOPUP_MAX)
+    amount?: number;
+}
+
 export class PageQueryDto {
     @ApiPropertyOptional({ default: 20, maximum: 50 })
     @IsOptional()
--- a/src/main.ts
+++ b/src/main.ts
@@ -1,5 +1,7 @@
 import { ValidationPipe } from '@nestjs/common';
-import { NestFactory } from '@nestjs/core';
+import { HttpAdapterHost, NestFactory } from '@nestjs/core';
+import { NestExpressApplication } from '@nestjs/platform-express';
+import { PaynetParseErrorFilter } from './modules/billing/providers/paynet/paynet-parse-error.filter';
 import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
 import { AppModule } from './app.module';
 import {
@@ -13,7 +15,13 @@
 import { PresenceResponse } from './modules/chat/responses/receipt.response';
 
 async function bootstrap() {
-  const app = await NestFactory.create(AppModule);
+  const app = await NestFactory.create<NestExpressApplication>(AppModule);
+
+  // Behind nginx on the same host: take the client IP from X-Forwarded-For,
+  // or Paynet's IP allowlist sees 127.0.0.1 for every call.
+  app.set('trust proxy', 'loopback');
+  // Malformed JSON on /api/paynet must still be a JSON-RPC answer (-32700).
+  app.useGlobalFilters(new PaynetParseErrorFilter(app.get(HttpAdapterHost).httpAdapter));
 
   app.useGlobalPipes(
     new ValidationPipe({
```

### 9.6 `.env`

```env
PAYNET_SERVICE_ID=1                 # serviceId Paynet sends (ask them)
PAYNET_USERNAME=paynet              # you choose these; give them to Paynet
PAYNET_PASSWORD=<long-random>
PAYNET_MERCHANT_ID=52589            # the "m" in the app link
# PAYNET_ACCOUNT_FIELD=client_id    # key in params.fields, if Paynet uses another
# PAYNET_ALLOWED_IPS=*              # local testing only; default is Paynet's two /28 nets
# PAYNET_PAY_URL=https://app.paynet.uz/
```

## 10. Testing with curl

Run with `PAYNET_ALLOWED_IPS=*`, `PAYNET_SERVICE_ID=1`, `PAYNET_USERNAME=paynet`, `PAYNET_PASSWORD=secret`.

```bash
URL=http://localhost:3000/api/paynet
AUTH=paynet:secret

# Account lookup
curl -s -u $AUTH -H 'Content-Type: application/json' $URL -d '{"jsonrpc":"2.0","id":1,"method":"GetInformation","params":{"serviceId":1,"fields":{"client_id":10001}}}'

# Pay 50 000 so'm (= 5 000 000 tiyin). Run twice: the second must return error 201.
curl -s -u $AUTH -H 'Content-Type: application/json' $URL -d '{"jsonrpc":"2.0","id":2,"method":"PerformTransaction","params":{"serviceId":1,"amount":5000000,"transactionId":12345678900,"fields":{"client_id":10001}}}'

# State: 1 paid, 2 cancelled, 3 not found
curl -s -u $AUTH -H 'Content-Type: application/json' $URL -d '{"jsonrpc":"2.0","id":3,"method":"CheckTransaction","params":{"serviceId":1,"transactionId":12345678900,"timestamp":"2026-10-13 12:00:00"}}'

# Reconciliation
curl -s -u $AUTH -H 'Content-Type: application/json' $URL -d '{"jsonrpc":"2.0","id":4,"method":"GetStatement","params":{"serviceId":1,"dateFrom":"2026-10-01 00:00:00","dateTo":"2026-12-31 23:59:59"}}'

# Cancel (77 if the user already spent the money; 202 on a second call)
curl -s -u $AUTH -H 'Content-Type: application/json' $URL -d '{"jsonrpc":"2.0","id":5,"method":"CancelTransaction","params":{"serviceId":1,"transactionId":12345678900,"timestamp":"2026-10-13 12:05:00"}}'

# Must be HTTP 401
curl -s -o /dev/null -w '%{http_code}\n' -u paynet:wrong -H 'Content-Type: application/json' $URL -d '{"jsonrpc":"2.0","id":6,"method":"GetInformation","params":{}}'

# Must be -32700
curl -s -u $AUTH -H 'Content-Type: application/json' $URL -d '{bad json'
```

Every call and answer is in `payment_webhook_events` (`provider = 'PAYNET'`).
