import { PaymentProviderKind } from "./billing.constants";

export const BILLING_EVENTS = {
    PAYMENT_PAID: 'billing.payment.paid',
    PAYMENT_CANCELLED: 'billing.payment.cancelled',
    PAYMENT_REVERSED: 'billing.payment.reversed'
} as const;

export class PaymentPaidEvent {
    constructor(
        public readonly paymentId: string,
        public readonly userId: string,
        public readonly provider: PaymentProviderKind,
        public readonly amount: string,
        public readonly bonusAmount: string,
        public readonly balance: string
    ) { }
}

export class PaymentCancelledEvent {
    constructor(
        public readonly paymentId: string,
        public readonly userId: string,
        public readonly provider: PaymentProviderKind,
        public readonly reason: string
    ) { }
}

export class PaymentReversedEvent {
    constructor(
        public readonly paymentId: string,
        public readonly userId: string,
        public readonly provider: PaymentProviderKind,
        public readonly amount: string,
        public readonly balance: string
    ) { }
}



