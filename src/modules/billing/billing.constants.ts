/**
 * The actions the server itself charges for — each at a specific place in
 * the code. A tariff whose `action` is one of these is applied automatically.
 *
 * An admin may also create tariffs under any other code of their own
 * (e.g. "VIP_BADGE"): those are listed to the app like the rest, but nothing
 * charges them until the feature that sells them exists.
 */
export const TARIFF_ACTIONS = ['LISTING_POST', 'LISTING_PROMOTE', 'VIDEO_POST'] as const;
export type TariffAction = (typeof TARIFF_ACTIONS)[number];
export const isBuiltInAction = (action: string): action is TariffAction =>
    (TARIFF_ACTIONS as readonly string[]).includes(action);

/** Built-in actions that buy TIME: their tariffs must carry duration_days. */
export const TIMED_ACTIONS: readonly string[] = ['LISTING_PROMOTE'];
export const isTimedAction = (action: string) => TIMED_ACTIONS.includes(action);

/**
 * Actions whose FIRST use per account is on the house.
 *
 * The grant is claimed in WalletService.chargeTariff, at the last moment
 * before the debit — after the admin check and after the zero-price check.
 * That placement is the point: an account must not burn its free post on an
 * action that was unpriced or free anyway, and then be charged for its real
 * first one once a price is set.
 *
 * Per ACCOUNT, not per phone or device. Creating a listing is behind
 * PhoneRequiredGuard (listings.controller.ts), so farming these costs one
 * SIM each — which is the floor, and the reason that guard must stay.
 */
export const FIRST_FREE_ACTIONS: readonly TariffAction[] = ['LISTING_POST'];
export const isFirstFreeAction = (action: string): boolean =>
    (FIRST_FREE_ACTIONS as readonly string[]).includes(action);

/** What an admin-typed action code must look like. */
export const TARIFF_ACTION_RE = /^[A-Z][A-Z0-9_]{1,39}$/;

export const TOPUP_MIN = 1_000;
export const TOPUP_MAX = 10_000_000;
export const PAYMENT_TTL_HOURS = 24;
export const FISCAL_MAX_ATTEMPTS = 5;

export enum TxKind {
    TOPUP = 'TOPUP',
    TOPUP_BONUS = 'TOPUP_BONUS',
    LISTING_POST = 'LISTING_POST',
    LISTING_PROMOTE = 'LISTING_PROMOTE',
    VIDEO_POST = 'VIDEO_POST',
    REFUND = 'REFUND',
    ADMIN_ADJUST = 'ADMIN_ADJUST',
}

export enum PaymentProviderKind {
    CLICK = 'CLICK',
    PAYME = 'PAYME',
    PAYNET = 'PAYNET',
}

export enum PaymentStatus {
    CREATED = 'CREATED',
    PREPARED = 'PREPARED',
    PAID = 'PAID',
    CANCELLED = 'CANCELLED',
}

export enum FiscalStatus {
    NONE = 'NONE',               // not paid yet, or fiscalisation not configured (FISCAL_* unset)
    BY_PROVIDER = 'BY_PROVIDER', // Payme fiscalises from our CheckPerformTransaction detail
    PENDING = 'PENDING',         // we must submit (Click)
    SENDING = 'SENDING',         // claimed by one submitter — nobody else may send it
    SENT = 'SENT',
    FAILED = 'FAILED',           // gave up after FISCAL_MAX_ATTEMPTS; an admin looks at fiscal_response
}

/** A SENDING claim older than this is a crashed submit and may be retried. */
export const FISCAL_CLAIM_STALE_MINUTES = 15;

/** numeric(14,2) comes out of pg as a string; all arithmetic is integer tiyin. */
export const toTiyin = (v: string | number): number => Math.round(Number(v) * 100);
export const fromTiyin = (t: number): string => (t / 100).toFixed(2);