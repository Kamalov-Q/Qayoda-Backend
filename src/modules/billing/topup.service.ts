import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { fromTiyin, PaymentProviderKind, toTiyin } from "./billing.constants";
import { PAYMENT_PROVIDERS, PaymentProvider } from "./providers/payment-provider";
import { DataSource, Repository } from 'typeorm';
import { WalletService } from "./wallet.service";
import { InjectRepository } from "@nestjs/typeorm";
import { Payment } from "./entities/payment.entity";

@Injectable()
export class TopupService {
    private readonly providers: Map<PaymentProviderKind, PaymentProvider>;

    constructor(
        private readonly dataSource: DataSource,
        private readonly wallet: WalletService,
        @InjectRepository(Payment) private readonly payments: Repository<Payment>,
        @Inject(PAYMENT_PROVIDERS) providers: PaymentProvider[],
    ) {
        this.providers = new Map(providers.map((p) => [p.kind, p]));
    }

    async createTop(userId: string, amountSum: number, kind: PaymentProviderKind, clientId?: string) {
        const provider = this.providers.get(kind);
        if (!provider) {
            throw new BadRequestException({ code: 'PROVIDER_UNAVAILABLE', message: `${kind} is not enabled` });
        }

        const amount = fromTiyin(toTiyin(amountSum));
        const payment = await this.createOrder(userId, kind, amount, clientId);
        const bonus = await this.wallet.bonusFor(this.dataSource.manager, toTiyin(amount));

        return {
            paymentId: payment.id,
            status: payment.status,
            provider: kind,
            payUrl: provider.buildPayUrl(payment),
            bonusPreview: { percent: bonus.percent, amount: fromTiyin(bonus.bonusTiyin) }
        }
    }

    /**
     * Idempotent on (user, clientId): the unique index decides the race, so
     * two identical requests arriving together still end as ONE order — the
     * loser's INSERT does nothing and it reads the winner's row.
     */
    private async createOrder(userId: string, kind: PaymentProviderKind, amount: string, clientId?: string): Promise<Payment> {
        if (!clientId) return this.payments.save(this.payments.create({ userId, provider: kind, amount }));

        await this.payments
            .createQueryBuilder().insert()
            .values({ userId, provider: kind, amount, clientId })
            .orIgnore()
            .execute();
        const payment = await this.payments.findOneOrFail({ where: { userId, clientId } });

        // The same key with different contents is a client bug, not a retry.
        if (payment.amount !== amount || payment.provider !== kind) {
            throw new ConflictException({
                code: 'CLIENT_ID_REUSED', message: 'This clientId was already used for a different top-up',
            });
        }
        return payment;
    }

    async getTopup(userId: string, id: string) {
        const p = await this.payments.findOne({ where: { id, userId } });
        if (!p) throw new NotFoundException({ code: 'PAYMENT_NOT_FOUND', message: 'Payment not found!' })
        return { id: p.id, provider: p.provider, status: p.status, amount: p.amount, bonusAmount: p.bonusAmount, paidAt: p.paidAt }
    }

}