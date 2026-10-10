import { Injectable, Logger } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { PaymentProviderKind } from "./billing.constants";
import { BILLING_EVENTS, PaymentPaidEvent } from "./billing.events";
import { ClickFiscalService } from "./providers/click/click-fiscal.service";

/**
 * Side effects of a payment, run AFTER it committed and after the provider
 * got its answer: nothing here can slow a callback down or roll money back.
 * A failure here is retried by ClickFiscalService's cron, never lost.
 */
@Injectable()
export class BillingEventsListener {
    private readonly logger = new Logger(BillingEventsListener.name);

    constructor(private readonly clickFiscal: ClickFiscalService) { }

    @OnEvent(BILLING_EVENTS.PAYMENT_PAID, { async: true })
    async onPaid(event: PaymentPaidEvent): Promise<void> {
        // Payme fiscalises itself from our CheckPerformTransaction `detail`.
        if (event.provider !== PaymentProviderKind.CLICK) return;
        try {
            await this.clickFiscal.submitForPayment(event.paymentId);
        } catch (err) {
            this.logger.error(`Fiscal submit crashed for ${event.paymentId}`, err instanceof Error ? err.stack : String(err));
        }
    }
}
