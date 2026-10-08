import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Not, Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { PaymentProviderKind, PaymentStatus, TariffKey, TxKind, fromTiyin, toTiyin } from './billing.constants';
import { AdjustWalletDto, CreateBonusTierDto, PatchBonusTierDto, PatchTariffDto } from './dto/billing.dto';
import { BonusTier } from './entities/bonus-tier.entity';
import { Payment } from './entities/payment.entity';
import { Tariff } from './entities/tariff.entity';
import { Wallet } from './entities/wallet.entity';
import { WalletService } from './wallet.service';

@Injectable()
export class BillingAdminService {
    constructor(
        private readonly dataSource: DataSource,
        private readonly wallet: WalletService,
        @InjectRepository(Tariff) private readonly tariffs: Repository<Tariff>,
        @InjectRepository(BonusTier) private readonly tiers: Repository<BonusTier>,
        @InjectRepository(Payment) private readonly payments: Repository<Payment>,
        @InjectRepository(Wallet) private readonly wallets: Repository<Wallet>,
    ) { }

    // ─── tariffs ──────────────────────────────────────────────────────────

    listTariffs() {
        return this.tariffs.find({ order: { key: 'ASC' } });
    }

    async patchTariff(key: string, dto: PatchTariffDto) {
        const tariff = await this.tariffs.findOne({ where: { key: key as TariffKey } });
        if (!tariff) throw new NotFoundException({ code: 'TARIFF_NOT_FOUND', message: `No tariff ${key}` });
        if (dto.nameUz !== undefined) tariff.nameUz = dto.nameUz.trim();
        if (dto.nameRu !== undefined) tariff.nameRu = dto.nameRu.trim();
        if (dto.price !== undefined) tariff.price = fromTiyin(toTiyin(dto.price));
        if (dto.durationDays !== undefined) {
            // A one-off action (posting a listing, a story) has nothing to last.
            if (tariff.durationDays === null) {
                throw new BadRequestException({ code: 'TARIFF_HAS_NO_DURATION', message: `${key} has no duration to set` });
            }
            tariff.durationDays = dto.durationDays;
        }
        if (dto.isActive !== undefined) tariff.isActive = dto.isActive;
        return this.tariffs.save(tariff);
    }

    // ─── bonus tiers ──────────────────────────────────────────────────────

    listBonusTiers() {
        return this.tiers.find({ order: { minAmount: 'ASC' } });
    }

    async createBonusTier(dto: CreateBonusTierDto) {
        const minAmount = fromTiyin(toTiyin(dto.minAmount));
        if (await this.tiers.exists({ where: { minAmount } })) {
            throw new ConflictException({ code: 'TIER_EXISTS', message: `A tier with min amount ${minAmount} exists` });
        }
        return this.tiers.save(this.tiers.create({ minAmount, percent: dto.percent }));
    }

    async patchBonusTier(id: string, dto: PatchBonusTierDto) {
        const tier = await this.tiers.findOne({ where: { id } });
        if (!tier) throw new NotFoundException({ code: 'TIER_NOT_FOUND', message: 'Bonus tier not found' });
        if (dto.minAmount !== undefined) {
            const minAmount = fromTiyin(toTiyin(dto.minAmount));
            // Without this the unique constraint answers with a bare 500.
            if (await this.tiers.exists({ where: { minAmount, id: Not(id) } })) {
                throw new ConflictException({ code: 'TIER_EXISTS', message: `A tier with min amount ${minAmount} exists` });
            }
            tier.minAmount = minAmount;
        }
        if (dto.percent !== undefined) tier.percent = dto.percent;
        if (dto.isActive !== undefined) tier.isActive = dto.isActive;
        return this.tiers.save(tier);
    }

    async deleteBonusTier(id: string) {
        const result = await this.tiers.delete({ id });
        if (!result.affected) throw new NotFoundException({ code: 'TIER_NOT_FOUND', message: 'Bonus tier not found' });
        return { deleted: true };
    }

    // ─── payments ─────────────────────────────────────────────────────────

    async listPayments(
        status: PaymentStatus | undefined, provider: PaymentProviderKind | undefined, limit: number, offset: number,
    ) {
        const qb = this.payments
            .createQueryBuilder('p')
            .leftJoin(User, 'u', 'u.id = p.userId')
            .select('p.id', 'id')
            .addSelect('p.userId', 'userId')
            .addSelect('p.provider', 'provider')
            .addSelect('p.amount', 'amount')
            .addSelect('p.bonusAmount', 'bonusAmount')
            .addSelect('p.status', 'status')
            .addSelect('p.prepareId', 'prepareId')
            .addSelect('p.providerTxnId', 'providerTxnId')
            .addSelect('p.providerError', 'providerError')
            .addSelect('p.cancelReason', 'cancelReason')
            .addSelect('p.paidAt', 'paidAt')
            .addSelect('p.cancelledAt', 'cancelledAt')
            .addSelect('p.createdAt', 'createdAt')
            .addSelect('u.name', 'userName')
            .addSelect('u.surname', 'userSurname')
            .addSelect('u.phoneNumber', 'userPhone')
            .orderBy('p.createdAt', 'DESC')
            .limit(limit)
            .offset(offset);
        if (status) qb.andWhere('p.status = :status', { status });
        if (provider) qb.andWhere('p.provider = :provider', { provider });

        const where = { ...(status ? { status } : {}), ...(provider ? { provider } : {}) };
        const [items, total] = await Promise.all([qb.getRawMany(), this.payments.count({ where })]);
        return { items, total, limit, offset };
    }

    // ─── wallets ──────────────────────────────────────────────────────────

    async listWallets(limit: number, offset: number) {
        const qb = this.wallets
            .createQueryBuilder('w')
            .leftJoin(User, 'u', 'u.id = w.userId')
            .select('w.userId', 'userId')
            .addSelect('w.balance', 'balance')
            .addSelect('w.updatedAt', 'updatedAt')
            .addSelect('u.name', 'userName')
            .addSelect('u.surname', 'userSurname')
            .addSelect('u.phoneNumber', 'userPhone')
            .orderBy('w.balance', 'DESC')
            .limit(limit)
            .offset(offset);

        const [items, total] = await Promise.all([qb.getRawMany(), this.wallets.count()]);
        return { items, total, limit, offset };
    }

    async adjustWallet(adminId: string, userId: string, dto: AdjustWalletDto) {
        const tiyin = toTiyin(dto.amount);
        const note = `[admin ${adminId}] ${dto.note}`;

        return this.dataSource.transaction(async (manager) => {
            const user = await manager.findOne(User, { where: { id: userId }, select: {id: true} });
            if (!user) throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User not found' });

            const balance = tiyin > 0
                ? await this.wallet.credit(manager, userId, tiyin, TxKind.ADMIN_ADJUST, null, note)
                : await this.wallet.debit(manager, userId, -tiyin, TxKind.ADMIN_ADJUST, null, note);

            return { userId, balance };
        });
    }
} 