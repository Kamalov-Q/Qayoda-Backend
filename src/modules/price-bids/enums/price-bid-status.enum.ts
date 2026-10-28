// enums/price-bid-status.enum.ts
export enum PriceBidStatus {
  /** Live. At most one per (listing, bidder) — see the partial unique index. */
  PENDING = 'PENDING',
  /** The other side said yes. An agreement to proceed, never a sale. */
  ACCEPTED = 'ACCEPTED',
  DECLINED = 'DECLINED',
  /** Superseded by a counter-offer, which is its own PENDING row. */
  COUNTERED = 'COUNTERED',
  /** Taken back by whoever made it. */
  WITHDRAWN = 'WITHDRAWN',
  /** Ran past `expires_at` without an answer. */
  EXPIRED = 'EXPIRED',
}

/** Statuses that are over. Nothing may be done to a bid in one of these. */
export const SETTLED_BID_STATUSES: readonly PriceBidStatus[] = [
  PriceBidStatus.ACCEPTED,
  PriceBidStatus.DECLINED,
  PriceBidStatus.COUNTERED,
  PriceBidStatus.WITHDRAWN,
  PriceBidStatus.EXPIRED,
];
