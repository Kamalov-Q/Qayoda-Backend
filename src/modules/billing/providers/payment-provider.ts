import { PaymentProviderKind } from "../billing.constants";
import { Payment } from "../entities/payment.entity";


export interface PaymentProvider {
    readonly kind: PaymentProviderKind;
    buildPayUrl(payment: Payment): string;
}

export const PAYMENT_PROVIDERS = Symbol('PAYMENT_PROVIDERS');