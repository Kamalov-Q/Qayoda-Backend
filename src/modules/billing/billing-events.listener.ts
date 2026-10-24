import { Injectable, Logger } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { DataSource } from "typeorm";
import { withIdempotency } from "src/shared/events/idempotent.util";
import { PaymentProviderKind } from "./billing.constants";
import { BILLING_EVENTS, PaymentPaidEvent } from "./billing.events";
import { ClickFiscalService } from "./providers/click/click-fiscal.service";
import { UserNotificationsService } from "../notifications/user-notifications.service";
import { NotificationKind } from "../notifications/notifications.constants";

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
        private readonly notifications: UserNotificationsService,
    ) { }

    /**
     * Tell the payer their money landed.
     *
     * Here rather than inside markPaid: this fires from the outbox, so it
     * runs only once the credit has actually committed. A "top-up succeeded"
     * written inside the transaction would be a promise the database could
     * still roll back.
     *
     * Its own idempotency key, separate from the fiscal one: a fiscal retry
     * must not re-notify, and a notification failure must not block fiscal.
     */
    @OnEvent(BILLING_EVENTS.PAYMENT_PAID, { async: true })
    async onPaidNotify(event: PaymentPaidEvent, eventId: string): Promise<void> {
        await withIdempotency(this.dataSource, eventId, 'billing.topup-notify', async () => {
            await this.notifications.notify({
                userId: event.userId,
                kind: NotificationKind.TOPUP_SUCCEEDED,
                // Printed by the row, joined to by nothing. The balance is
                // included so the inbox can say what it is now rather than
                // only what moved.
                meta: {
                    amount: event.amount,
                    bonusAmount: event.bonusAmount,
                    balance: event.balance,
                    provider: event.provider,
                },
            });
        });
    }

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
