import { PaymentProviderKind } from "../billing.constants";
import { Payment } from "../entities/payment.entity";


/**
 * What the CALLER knows about the payer that the order row does not.
 *
 * Neither field can change what is charged or to whom — they only decide
 * which language the checkout opens in and which of our own configured
 * return addresses it comes back to. That is deliberate: a return URL
 * taken from the request would be an open redirect on a payment page, so
 * the client picks between values the server already holds instead of
 * supplying one.
 */
export interface PayUrlOptions {
    /** The payer's language. Defaults to Uzbek, as it always did. */
    lang?: 'uz' | 'ru';
    /** Where the payer is paying from. Defaults to the app. */
    client?: 'APP' | 'WEB';
}

export interface PaymentProvider {
    readonly kind: PaymentProviderKind;
    buildPayUrl(payment: Payment, options?: PayUrlOptions): string;
}

export const PAYMENT_PROVIDERS = Symbol('PAYMENT_PROVIDERS');