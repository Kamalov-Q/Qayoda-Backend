import { BadRequestException, HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Wallet } from "./entities/wallet.entity";
import { WalletTransaction } from "./entities/wallet-transaction.entity";
import { Tariff } from "./entities/tariff.entity";
import { BonusTier } from "./entities/bonus-tier.entity";
import { fromTiyin, TariffAction, toTiyin, TxKind } from "./billing.constants";
import { User } from "../users/entities/user.entity";
import { UserRole } from "src/shared/enums";

@Injectable()
export class WalletService {
    constructor(
        private readonly dataSource: DataSource,
        @InjectRepository(Wallet) private readonly wallets: Repository<Wallet>,
        @InjectRepository(WalletTransaction) private readonly transactions: Repository<WalletTransaction>,
        @InjectRepository(Tariff) private readonly tariffs: Repository<Tariff>,
        @InjectRepository(BonusTier) private readonly tiers: Repository<BonusTier>,
    ) { }

    async overview(userId: string) {
        const balance = await this.getBalance(this.dataSource.manager, userId);
        const [tariffs, bonusTiers] = await Promise.all([
            this.tariffs.find({ where: { isActive: true }, order: { action: 'ASC', price: 'ASC' } }),
            this.tiers.find({ where: { isActive: true }, order: { minAmount: 'ASC' } })
        ]);

        return {
            balance,
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
        if (user?.role === UserRole.ADMIN) return;

        const priceTiyin = toTiyin(tariff.price);
        if (priceTiyin <= 0) return;

        await this.debit(manager, userId, priceTiyin, tariff.action as unknown as TxKind, referenceId ?? null, tariff.nameUz);
    }

    async refund(
        manager: EntityManager, userId: string, amount: string | number, referenceId: string | null, note: string
    ): Promise<string> {
        return this.credit(manager, userId, toTiyin(amount), TxKind.REFUND, referenceId, note);
    }

    async debit(
        manager: EntityManager,
        userId: string, amountTiyin: number, kind: TxKind,
        referenceId: string | null, note: string | null
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
            throw new HttpException({ code: 'INSUFFICIENT_FUNDS', message: `Need ${amount} so'm, balance is ${balance}`, required: amount, balance },
                HttpStatus.PAYMENT_REQUIRED);
        }

        await manager.insert(WalletTransaction, {
            userId, amount: fromTiyin(-amountTiyin), kind, referenceId, balanceAfter: rows[0].balance, note
        });
        return rows[0].balance;

    }

    async credit(manager: EntityManager, userId: string, amountTiyin: number, kind: TxKind, referenceId: string | null, note: string | null): Promise<string> {
        this.assertPositive(amountTiyin);
        const amount = fromTiyin(amountTiyin);
        await this.ensureWallet(manager, userId);

        // TypeORM answers a raw UPDATE … RETURNING with [rows, affectedCount].
        const [rows]: [{ balance: string }[], number] = await manager.query(
            `UPDATE wallets SET balance = balance + $1::numeric, updated_at = now() 
            WHERE user_id = $2 RETURNING balance`,
            [amount, userId],
        );

        await manager.insert(WalletTransaction, { userId, amount, kind, referenceId, balanceAfter: rows[0].balance, note });
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