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
import { ConfigService } from '@nestjs/config';
import { PaymeProvider } from './providers/payme/payme.provider';
import { PaymeWebhookController } from './providers/payme/payme.controller';
import { FiscalService } from './fiscal.service';
import { ClickFiscalService } from './providers/click/click-fiscal.service';
import { BillingEventsListener } from './billing-events.listener';

@Module({
    imports: [
        AuthModule,
        TypeOrmModule.forFeature([Wallet, WalletTransaction, Payment, PaymentWebhookEvent, Tariff, BonusTier, User]),
    ],
    controllers: [WalletController, ClickWebhookController, PaymeWebhookController, BillingAdminController],
    providers: [
        WalletService,
        PaymentsService,
        TopupService,
        BillingAdminService,
        FiscalService,
        ClickProvider,
        ClickFiscalService,
        PaymeProvider,
        BillingEventsListener,
        // What the app may offer: a provider without its credentials would
        // hand out checkout links that cannot work, so it is left out.
        {
            provide: PAYMENT_PROVIDERS,
            useFactory: (config: ConfigService, click: ClickProvider, payme: PaymeProvider) => [
                ...(config.get('CLICK_SERVICE_ID') && config.get('CLICK_SECRET_KEY') ? [click] : []),
                ...(config.get('PAYME_MERCHANT_ID') && config.get('PAYME_KEY') ? [payme] : []),
            ],
            inject: [ConfigService, ClickProvider, PaymeProvider],
        },
    ],
    exports: [WalletService],
})
export class BillingModule { }