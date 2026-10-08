export const TARIFF_KEYS = ['LISTING_POST', 'STORY_POST', 'LISTING_PROMOTE'] as const;
export type TariffKey = (typeof TARIFF_KEYS)[number];

/** Fallback only — the live value is the LISTING_PROMOTE tariff's duration_days. */
export const PROMOTE_DAYS = 7;
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

/**
 * `durationDays` marks the tariffs that buy TIME (how long the paid effect
 * lasts); null means the action is one-off and has no duration to edit.
 */
export const TARIFF_SEEDS: { key: TariffKey; nameUz: string; nameRu: string; price: string; durationDays: number | null }[] = [
    { key: 'LISTING_POST', nameUz: "E'lon joylash", nameRu: 'Размещение объявления', price: '5000.00', durationDays: null },
    { key: 'STORY_POST', nameUz: 'Story joylash', nameRu: 'Загрузка истории', price: '5000.00', durationDays: null },
    { key: 'LISTING_PROMOTE', nameUz: 'TOPga chiqarish', nameRu: 'Поднять в TOP', price: '10000.00', durationDays: PROMOTE_DAYS },
];

export const BONUS_TIER_SEEDS: { minAmount: string; percent: number }[] = [
    { minAmount: '100000.00', percent: 10 },
    { minAmount: '500000.00', percent: 15 },
    { minAmount: '1000000.00', percent: 20 },
    { minAmount: '2000000.00', percent: 25 },
    { minAmount: '3000000.00', percent: 30 },
    { minAmount: '5000000.00', percent: 40 },
];

/** numeric(14,2) comes out of pg as a string; all arithmetic is integer tiyin. */
export const toTiyin = (v: string | number): number => Math.round(Number(v) * 100);
export const fromTiyin = (t: number): string => (t / 100).toFixed(2);