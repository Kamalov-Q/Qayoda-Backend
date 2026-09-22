/**
 * Why a listing can be reported. Fixed keys — the clients render localized
 * labels for them, and OTHER opens a free-text field. Kept as data-free
 * constants (unlike categories/amenities) on purpose: moderation reasons are
 * product policy, not content an admin curates.
 */
export const REPORT_REASONS = [
  /** Scam / fraud attempt. */
  'FRAUD',
  /** Photos or details don't match reality. */
  'WRONG_INFO',
  /** Already sold or rented, still listed. */
  'ALREADY_SOLD',
  /** Price in the listing is not the real price. */
  'WRONG_PRICE',
  /** Same property posted multiple times. */
  'DUPLICATE',
  /** Offensive or inappropriate content. */
  'INAPPROPRIATE',
  /** Anything else — requires the free-text comment. */
  'OTHER',
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_STATUSES = ['OPEN', 'RESOLVED', 'DISMISSED'] as const;
