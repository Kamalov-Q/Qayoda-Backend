/**
 * The actions the server itself charges for — each at a specific place in
 * the code. A tariff whose `action` is one of these is applied automatically.
 *
 * An admin may also create tariffs under any other code of their own
 * (e.g. "VIP_BADGE"): those are listed to the app like the rest, but nothing
 * charges them until the feature that sells them exists.
 */
export const TARIFF_ACTIONS = ['LISTING_POST', 'STORY_POST', 'LISTING_PROMOTE'] as const;
export type TariffAction = (typeof TARIFF_ACTIONS)[number];
export const isBuiltInAction = (action: string): action is TariffAction =>
    (TARIFF_ACTIONS as readonly string[]).includes(action);

/** Built-in actions that buy TIME: their tariffs must carry duration_days. */
export const TIMED_ACTIONS: readonly string[] = ['LISTING_PROMOTE'];
export const isTimedAction = (action: string) => TIMED_ACTIONS.includes(action);

/** What an admin-typed action code must look like. */
export const TARIFF_ACTION_RE = /^[A-Z][A-Z0-9_]{1,39}$/;

export const TOPUP_MIN = 1_000;
export const TOPUP_MAX = 10_000_000;
export const PAYMENT_TTL_HOURS = 24;

export enum TxKind {
    TOPUP = 'TOPUP',
    TOPUP_BONUS = 'TOPUP_BONUS',
    LISTING_POST = 'LISTING_POST',
    STORY_POST = 'STORY_POST',
    LISTING_PROMOTE = 'LISTING_PROMOTE',
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

/** numeric(14,2) comes out of pg as a string; all arithmetic is integer tiyin. */
export const toTiyin = (v: string | number): number => Math.round(Number(v) * 100);
export const fromTiyin = (t: number): string => (t / 100).toFixed(2);