import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { User } from '../users/entities/user.entity';
import { BillingAdminController } from './billing-admin.controller';
import { BillingAdminService } from './billing-admin.service';
import { WalletController } from './billing.controller';
import { BonusTier } from './entities/bonus-tier.entity';
import { PaymentWebhookEvent } from './entities/payment-webhook-event.entity';
import { Payment } from './entities/payment.entity';
import { Tariff } from './entities/tariff.entity';
import { WalletTransaction } from './entities/wallet-transaction.entity';
import { Wallet } from './entities/wallet.entity';
import { PaymentsService } from './payments.service';
import { ClickWebhookController } from './providers/click/click.controller';
import { ClickProvider } from './providers/click/click.provider';
import { PAYMENT_PROVIDERS } from './providers/payment-provider';
import { TopupService } from './topup.service';
import { WalletService } from './wallet.service';

@Module({
    imports: [
        AuthModule,
        TypeOrmModule.forFeature([Wallet, WalletTransaction, Payment, PaymentWebhookEvent, Tariff, BonusTier, User]),
    ],
    controllers: [WalletController, ClickWebhookController, BillingAdminController],
    providers: [
        WalletService,
        PaymentsService,
        TopupService,
        BillingAdminService,
        ClickProvider,
        // Adding Payme later: add PaymeProvider here, to the list below, and its controller above.
        { provide: PAYMENT_PROVIDERS, useFactory: (click: ClickProvider) => [click], inject: [ClickProvider] },
    ],
    exports: [WalletService],
})
export class BillingModule { }