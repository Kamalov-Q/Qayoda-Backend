import { BadRequestException, HttpException, HttpStatus, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Wallet } from "./entities/wallet.entity";
import { WalletTransaction } from "./entities/wallet-transaction.entity";
import { Tariff } from "./entities/tariff.entity";
import { BonusTier } from "./entities/bonus-tier.entity";
import { Payment } from "./entities/payment.entity";
import { FIRST_FREE_ACTIONS, fromTiyin, isFirstFreeAction, TariffAction, toTiyin, TxKind } from "./billing.constants";
import { FreeGrant } from "./entities/free-grant.entity";
import { User } from "../users/entities/user.entity";
import { UserRole } from "src/shared/enums";

/** Who did it and under which key — carried onto the ledger row. */
export interface TxAudit {
    /** The caller's idempotency key, for an adjustment that may be retried. */
    clientId?: string | null;
    /** The admin behind a manual adjustment. */
    adminId?: string | null;
}

/** The most a numeric(14,2) balance column can hold. */
export const MAX_BALANCE = 999_999_999_999.99;

@Injectable()
export class WalletService {
    /** TEMPORARY TRACE — remove once paid actions are confirmed in production.
     *  Every charge passes through chargeTariff/debit, so one logger here
     *  covers listing posts, story posts and TOP without touching callers. */
    private readonly log = new Logger('Billing');

    constructor(
        private readonly dataSource: DataSource,
        @InjectRepository(Wallet) private readonly wallets: Repository<Wallet>,
        @InjectRepository(WalletTransaction) private readonly transactions: Repository<WalletTransaction>,
        @InjectRepository(Tariff) private readonly tariffs: Repository<Tariff>,
        @InjectRepository(BonusTier) private readonly tiers: Repository<BonusTier>,
    ) { }

    async overview(userId: string) {
        const balance = await this.getBalance(this.dataSource.manager, userId);
        const [accountNo, tariffs, bonusTiers, freeActions] = await Promise.all([
            this.accountNo(userId),
            this.tariffs.find({ where: { isActive: true }, order: { action: 'ASC', price: 'ASC' } }),
            this.tiers.find({ where: { isActive: true }, order: { minAmount: 'ASC' } }),
            this.freeActionsFor(this.dataSource.manager, userId),
        ]);

        return {
            balance,
            accountNo,
            /**
             * Which first-use-free actions this account has NOT spent yet.
             *
             * Here rather than on /tariffs because it is per-account and
             * /tariffs is deliberately public and cached for minutes — a
             * price is not a secret, but whose freebie is unspent is not a
             * price. This endpoint is already Cache-Control: no-store.
             */
            freeActions,
            tariffs: tariffs.map((t) => ({
                id: t.id, action: t.action, nameUz: t.nameUz, nameRu: t.nameRu, price: t.price, durationDays: t.durationDays,
            })),
            bonusTiers: bonusTiers.map((t) => ({ minAmount: t.minAmount, percent: t.percent }))
        }
    }

    async listTransactions(userId: string, limit: number, offset: number) {
        const [items, total] = await this.transactions.findAndCount({
            where: { userId }, order: { createdAt: 'DESC' }, take: limit,
            skip: offset
        });

        return { items, total, limit, offset };
    }

    /**
     * One ledger line with what it came from: for a top-up, its bonus or its
     * reversal, the provider payment (order number, provider's transaction id,
     * status, fiscal receipt); for a promotion, the listing.
     */
    async getTransaction(userId: string, id: string) {
        const tx = await this.transactions.findOne({ where: { id, userId } });
        if (!tx) throw new NotFoundException({ code: 'TRANSACTION_NOT_FOUND', message: 'Transaction not found' });

        const fromPayment = [TxKind.TOPUP, TxKind.TOPUP_BONUS, TxKind.REFUND].includes(tx.kind);
        // userId in the WHERE too: a referenceId must never open someone else's payment.
        const payment = fromPayment && tx.referenceId
            ? await this.dataSource.manager.findOne(Payment, { where: { id: tx.referenceId, userId } })
            : null;

        return {
            ...tx,
            listingId: tx.kind === TxKind.LISTING_PROMOTE ? tx.referenceId : null,
            payment: payment && {
                id: payment.id,
                orderNo: payment.prepareId,
                provider: payment.provider,
                status: payment.status,
                amount: payment.amount,
                bonusAmount: payment.bonusAmount,
                providerTxnId: payment.providerTxnId,
                fiscalStatus: payment.fiscalStatus,
                createdAt: payment.createdAt,
                paidAt: payment.paidAt,
                cancelledAt: payment.cancelledAt,
                cancelReason: payment.cancelReason,
            },
        };
    }

    /** The short public number the user pays into via Paynet ("Hisob raqami"). */
    async accountNo(userId: string): Promise<number> {
        const user = await this.dataSource.manager.findOneOrFail(User, { where: { id: userId }, select: { id: true, accountNo: true } });
        return user.accountNo;
    }

    async getBalance(manager: EntityManager, userId: string): Promise<string> {
        await this.ensureWallet(manager, userId);
        const wallet = await manager.findOneOrFail(Wallet, { where: { userId } });
        return wallet.balance;
    }

    async bonusFor(manager: EntityManager, amountTiyin: number): Promise<{ percent: number; bonusTiyin: number }> {
        const tiers = await manager.find(BonusTier, { where: { isActive: true }, order: { minAmount: 'DESC' } });
        const tier = tiers.find((t) => toTiyin(t.minAmount) <= amountTiyin);
        if (!tier) return { percent: 0, bonusTiyin: 0 };
        return { percent: tier.percent, bonusTiyin: Math.floor((amountTiyin * tier.percent) / 100) }
    }

    /**
     * Charge a ONE-OFF action (post a listing, a story) at the admin's price.
     * No active tariff for the action = it is free. Admins are never charged.
     */
    async charge(manager: EntityManager, userId: string, action: TariffAction, referenceId?: string): Promise<void> {
        const tariff = await manager.findOne(Tariff, { where: { action, isActive: true } });
        if (!tariff) return;
        await this.chargeTariff(manager, userId, tariff, referenceId);
    }

    /**
     * The tariff a TIMED action (TOP placement) is being bought with. Unlike a
     * one-off, no tariff does not mean free — it means not for sale, or free
     * promotion would put every listing on top.
     */
    async resolveTimedTariff(manager: EntityManager, action: TariffAction, tariffId?: string): Promise<Tariff> {
        const active = await manager.find(Tariff, { where: { action, isActive: true }, order: { durationDays: 'ASC' } });
        const timed = active.filter((t) => t.durationDays !== null);
        if (timed.length === 0) {
            throw new BadRequestException({ code: 'TARIFF_UNAVAILABLE', message: 'This service is not available right now' });
        }
        if (tariffId) {
            const chosen = timed.find((t) => t.id === tariffId);
            if (!chosen) throw new BadRequestException({ code: 'TARIFF_NOT_FOUND', message: 'No such tariff for this action' });
            return chosen;
        }
        if (timed.length > 1) {
            throw new BadRequestException({ code: 'TARIFF_REQUIRED', message: 'Choose a tariff: send tariffId' });
        }
        return timed[0];
    }

    /** Debit one specific tariff's price. Free for admins and for a zero price. */
    async chargeTariff(manager: EntityManager, userId: string, tariff: Tariff, referenceId?: string): Promise<void> {
        const user = await manager.findOne(User, { where: { id: userId }, select: { id: true, role: true } });
        if (user?.role === UserRole.ADMIN) {
            this.log.warn(
                `SKIPPED ${tariff.action} for ${userId}: account is ADMIN, so nothing is charged. ` +
                `Test a paid action from a non-admin account.`,
            );
            return;
        }

        const priceTiyin = toTiyin(tariff.price);
        if (priceTiyin <= 0) {
            this.log.log(`SKIPPED ${tariff.action} for ${userId}: price is ${tariff.price} (free)`);
            return;
        }

        // LAST thing before the money moves. Everything above has already
        // ruled out the cases where nothing would have been charged anyway
        // (admin, no tariff, zero price) — claiming the grant before those
        // checks would spend it on a free action and then charge the account
        // for its real first one.
        if (isFirstFreeAction(tariff.action) && await this.claimFreeAction(manager, userId, tariff.action, referenceId)) {
            this.log.log(`FREE ${tariff.action} for ${userId}: first one on the house (${tariff.price} waived)`);
            return;
        }

        this.log.log(
            `CHARGE ${tariff.action} ${tariff.price} to ${userId}` +
            `${referenceId ? ` ref=${referenceId}` : ''} tariff=${tariff.id}`,
        );
        await this.debit(manager, userId, priceTiyin, tariff.action as unknown as TxKind, referenceId ?? null, tariff.nameUz);
    }

    /**
     * Spend this account's free go at `action`, if it still has one.
     *
     * True = it was unspent and is now spent, so the caller must NOT charge.
     *
     * `ON CONFLICT DO NOTHING` with `RETURNING` is the whole concurrency
     * story: the composite primary key makes two simultaneous posts race on
     * one row, the loser gets zero rows back and pays. Reading first and then
     * inserting would let both through.
     *
     * Runs on the caller's `manager`, so it is inside the listing's
     * transaction: if anything after the charge fails, the listing and the
     * claim roll back together and the account keeps its free post. There is
     * no refund path to get it back by hand — see resetFreeAction, which is
     * the admin's.
     */
    private async claimFreeAction(
        manager: EntityManager, userId: string, action: string, referenceId?: string,
    ): Promise<boolean> {
        // NOT `const [rows] = await …`. On Postgres, TypeORM's query()
        // returns the rows array itself, so destructuring takes the FIRST
        // ROW — an object whose `.length` is undefined, making `> 0` false
        // and this method answer "not claimed" about the claim it just
        // wrote. The caller then charges, the empty wallet throws
        // INSUFFICIENT_FUNDS, and the row rolls back with it: the account
        // is refused AND keeps a grant that never shows up anywhere.
        // user-notifications.service.ts does the same INSERT … RETURNING
        // without destructuring; this now matches it.
        const rows: { user_id: string }[] = await manager.query(
            `INSERT INTO free_grants (user_id, action, reference_id)
            VALUES ($1, $2, $3)
            ON CONFLICT (user_id, action) DO NOTHING
            RETURNING user_id
            `,
            [userId, action, referenceId ?? null],
        );
        return rows.length > 0;
    }

    /**
     * The first-use-free actions this account has left, for the app to label
     * the post form with. Only ever a handful of codes, so one read of the
     * used rows and a subtraction beats a query per action.
     */
    async freeActionsFor(manager: EntityManager, userId: string): Promise<string[]> {
        if (FIRST_FREE_ACTIONS.length === 0) return [];
        const used = await manager.find(FreeGrant, { where: { userId }, select: { action: true } });
        const spent = new Set(used.map((g) => g.action));
        return FIRST_FREE_ACTIONS.filter((a) => !spent.has(a));
    }

    async refund(
        manager: EntityManager, userId: string, amount: string | number, referenceId: string | null, note: string
    ): Promise<string> {
        return this.credit(manager, userId, toTiyin(amount), TxKind.REFUND, referenceId, note);
    }

    async debit(
        manager: EntityManager,
        userId: string, amountTiyin: number, kind: TxKind,
        referenceId: string | null, note: string | null, audit?: TxAudit,
    ): Promise<string> {
        this.assertPositive(amountTiyin);
        const amount = fromTiyin(amountTiyin);
        await this.ensureWallet(manager, userId);

        // TypeORM answers a raw UPDATE … RETURNING with [rows, affectedCount].
        const [rows]: [{ balance: string }[], number] = await manager.query(
            `UPDATE wallets SET balance = balance - $1::numeric, updated_at = now()
            WHERE user_id = $2 AND balance >= $1::numeric
            RETURNING balance
            `,
            [amount, userId],
        );

        if (rows.length === 0) {
            const balance = await this.getBalance(manager, userId);
            this.log.warn(`REFUSED ${kind} ${amount} for ${userId}: balance is ${balance}`);
            throw new HttpException({ code: 'INSUFFICIENT_FUNDS', message: `Need ${amount} so'm, balance is ${balance}`, required: amount, balance },
                HttpStatus.PAYMENT_REQUIRED);
        }

        await manager.insert(WalletTransaction, {
            userId, amount: fromTiyin(-amountTiyin), kind, referenceId, balanceAfter: rows[0].balance, note,
            clientId: audit?.clientId ?? null, adminId: audit?.adminId ?? null,
        });
        // NOTE: still inside the caller's transaction. A later failure rolls
        // this back, so a DEBITED line is not yet proof the money moved —
        // the wallet_transactions row is.
        this.log.log(`DEBITED ${kind} ${amount} from ${userId}, balance now ${rows[0].balance}`);
        return rows[0].balance;

    }

    async credit(
        manager: EntityManager, userId: string, amountTiyin: number, kind: TxKind,
        referenceId: string | null, note: string | null, audit?: TxAudit,
    ): Promise<string> {
        this.assertPositive(amountTiyin);
        const amount = fromTiyin(amountTiyin);
        await this.ensureWallet(manager, userId);

        // balance is numeric(14,2), so anything from 10^12 up is rejected by
        // Postgres with 22003 — which reached the caller as a bare 500 after
        // the transaction had already rolled back. Checked here so an
        // impossible credit is a 400 that says what the limit is.
        const current = await this.getBalance(manager, userId);
        if (Number(current) + Number(amount) > MAX_BALANCE) {
            throw new BadRequestException({
                code: 'BALANCE_LIMIT',
                message: `A wallet cannot exceed ${MAX_BALANCE} so'm (balance is ${current})`,
                limit: String(MAX_BALANCE),
                balance: current,
            });
        }

        // TypeORM answers a raw UPDATE … RETURNING with [rows, affectedCount].
        const [rows]: [{ balance: string }[], number] = await manager.query(
            `UPDATE wallets SET balance = balance + $1::numeric, updated_at = now() 
            WHERE user_id = $2 RETURNING balance`,
            [amount, userId],
        );

        await manager.insert(WalletTransaction, {
            userId, amount, kind, referenceId, balanceAfter: rows[0].balance, note,
            clientId: audit?.clientId ?? null, adminId: audit?.adminId ?? null,
        });
        return rows[0].balance;
    }


    /** A zero, negative or NaN amount must never reach the balance UPDATE. */
    private assertPositive(amountTiyin: number): void {
        if (!Number.isSafeInteger(amountTiyin) || amountTiyin <= 0) {
            throw new BadRequestException({ code: 'INVALID_AMOUNT', message: 'Amount must be positive' });
        }
    }

    private async ensureWallet(manager: EntityManager, userId: string): Promise<void> {
        await manager.query(`INSERT INTO wallets (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`, [userId]);
    }




}