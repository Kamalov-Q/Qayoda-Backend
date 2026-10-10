import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { FiscalService } from "../../fiscal.service";
import { PaymentsService } from "../../payments.service";
import { Payment } from "../../entities/payment.entity";
import { PaymentProviderKind, PaymentStatus, toTiyin } from "../../billing.constants";
import { createHash } from "crypto";
import { Cron, CronExpression } from "@nestjs/schedule";

const CLICK_FISCAL_URL = 'https://api.click.uz/v2/merchant/payment/ofd_data/submit_items';

@Injectable()
export class ClickFiscalService {
    private readonly logger = new Logger(ClickFiscalService.name);

    constructor(
        private readonly config: ConfigService,
        private readonly fiscal: FiscalService,
        private readonly payments: PaymentsService
    ) { }

    async submitForPayment(paymentId: string): Promise<void> {
        const payment = await this.payments.findById(paymentId);
        if (!payment) return;
        await this.submit(payment);
    }

    /** Retry what is still owed (network blips, Click downtime). */
    @Cron(CronExpression.EVERY_10_MINUTES)
    async retryDue(): Promise<void> {
        if (!this.fiscal.enabled) return;
        const due = await this.payments.listFiscalDue(PaymentProviderKind.CLICK);
        for (const p of due) {
            // One bad receipt must not stop the rest of the batch.
            await this.submit(p).catch((err) =>
                this.logger.error(`Fiscal retry crashed for ${p.id}`, err instanceof Error ? err.stack : String(err)),
            );
        }
    }


    private async submit(payment: Payment): Promise<void> {
        if (payment.provider !== PaymentProviderKind.CLICK || payment.status !== PaymentStatus.PAID) return;
        if (!this.fiscal.enabled) return;
        // Exactly one submitter per receipt: the listener and the cron can
        // both reach here for the same payment.
        if (!(await this.payments.claimFiscal(payment.id))) return;
        if (!payment.providerDocId) {
            await this.payments.markFiscalResult(payment.id, false, { error: 'missing click_paydoc_id!' });
            return;
        }

        let ok = false;
        let response: Record<string, unknown>;
        try {
            const line = this.fiscal.topupLine(toTiyin(payment.amount));
            const body = {
                service_id: Number(this.config.getOrThrow<string>('CLICK_SERVICE_ID')),
                payment_id: Number(payment.providerDocId),
                items: [{
                    Name: line.title,
                    SPIC: line.mxik,
                    PackageCode: line.packageCode,
                    GoodPrice: line.unitPriceTiyin,
                    Price: line.totalTiyin,
                    Amount: line.count,
                    VAT: line.vatTiyin,
                    VATPercent: line.vatPercent,
                    CommissionInfo: { TIN: line.tin },
                }],
                received_ecash: 0,
                received_cash: 0,
                received_card: line.totalTiyin
            };
            const res = await fetch(CLICK_FISCAL_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                    Auth: this.authHeader()
                },
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(10_000),
            });
            const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
            ok = res.ok && Number(json.error_code ?? json.error ?? 0) === 0;
            response = { http: res.status, ...json };
        }
        catch (err) {
            response = { error: err instanceof Error ? err.message : String(err) };
        }

        await this.payments.markFiscalResult(payment.id, ok, response);
        if (ok) this.logger.log(`Fiscal receipt sent for Click payment ${payment.id} (paydoc ${payment.providerDocId})`);
        else this.logger.warn(`Fiscal submit failed for ${payment.id}: ${JSON.stringify(response)}`);

    }

    private authHeader(): string {
        const ts = Math.floor(Date.now() / 1000);
        const userId = this.config.getOrThrow<string>('CLICK_MERCHANT_USER_ID');
        const secret = this.config.getOrThrow<string>('CLICK_SECRET_KEY');
        const digest = createHash('sha1').update(`${ts}${secret}`).digest('hex');
        return `${userId}:${digest}:${ts}`;
    }

}
