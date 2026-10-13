import { Injectable, Logger } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { DataSource } from "typeorm";
import { withIdempotency } from "src/shared/events/idempotent.util";
import { PaymentProviderKind } from "./billing.constants";
import { BILLING_EVENTS, PaymentPaidEvent } from "./billing.events";
import { ClickFiscalService } from "./providers/click/click-fiscal.service";

/**
 * Side effects of a payment. Events arrive from the outbox (OutboxRelayService),
 * so only after the money committed — and AT LEAST once: every handler runs
 * under withIdempotency on the outbox event id. Payloads are plain JSON with
 * the fields of the billing.events.ts classes.
 * A fiscal failure here is retried by ClickFiscalService's cron, never lost.
 */
@Injectable()
export class BillingEventsListener {
    private readonly logger = new Logger(BillingEventsListener.name);

    constructor(
        private readonly dataSource: DataSource,
        private readonly clickFiscal: ClickFiscalService,
    ) { }

    @OnEvent(BILLING_EVENTS.PAYMENT_PAID, { async: true })
    async onPaid(event: PaymentPaidEvent, eventId: string): Promise<void> {
        // Payme fiscalises itself from our CheckPerformTransaction `detail`;
        // Paynet per PAYNET_FISCAL. Only Click needs us to submit.
        if (event.provider !== PaymentProviderKind.CLICK) return;

        await withIdempotency(this.dataSource, eventId, 'billing.click-fiscal', async () => {
            try {
                await this.clickFiscal.submitForPayment(event.paymentId);
            } catch (err) {
                this.logger.error(`Fiscal submit crashed for ${event.paymentId}`, err instanceof Error ? err.stack : String(err));
            }
        });
    }
}
