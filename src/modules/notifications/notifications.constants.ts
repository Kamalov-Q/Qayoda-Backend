/**
 * What the app tells someone about, in their own inbox.
 *
 * Deliberately short. A notification is a claim on attention, and the list
 * of things worth claiming it for is shorter than the list of things that
 * happen: something you made became public, somebody reacted to it, somebody
 * started following you. Nothing here is about what the platform did.
 */
export enum NotificationKind {
  /** Bunny finished encoding and the video was paid for and published. */
  VIDEO_READY = 'VIDEO_READY',
  /** The video could not be published — too long, or encoding failed. */
  VIDEO_FAILED = 'VIDEO_FAILED',
  /** Encoded and valid, but the wallet was empty. There is a button for this. */
  VIDEO_AWAITING_PAYMENT = 'VIDEO_AWAITING_PAYMENT',
  VIDEO_LIKE = 'VIDEO_LIKE',
  VIDEO_COMMENT = 'VIDEO_COMMENT',
  COMMENT_REPLY = 'COMMENT_REPLY',
  NEW_FOLLOWER = 'NEW_FOLLOWER',

  /**
   * Somebody you follow published a reel. The one kind here that is about
   * someone else's activity rather than a reaction to yours — a following
   * list is a subscription, and this is what it delivers.
   */
  FOLLOWED_USER_POSTED = 'FOLLOWED_USER_POSTED',

  // --- listings: the actual product, silent until now ---------------------
  LISTING_COMMENT = 'LISTING_COMMENT',
  LISTING_COMMENT_REPLY = 'LISTING_COMMENT_REPLY',
  LISTING_REVIEW = 'LISTING_REVIEW',

  // --- chat ---------------------------------------------------------------
  /** One row per CONVERSATION, not per message. See CHAT_DEDUPE below. */
  CHAT_MESSAGE = 'CHAT_MESSAGE',

  // --- price bids ---------------------------------------------------------
  //
  // ⚠️ A client that predates these renders an unknown kind, and the inbox
  // screen indexes a fixed map by kind. Ship the app update BEFORE anything
  // starts emitting these — see sql/2026-10-28-price-bids.sql.
  /** Somebody offered a price on your advert. `meta` carries the amount. */
  PRICE_BID_RECEIVED = 'PRICE_BID_RECEIVED',
  /** The seller answered with a number of their own. */
  PRICE_BID_COUNTERED = 'PRICE_BID_COUNTERED',
  /** Your bid was accepted. An agreement to proceed, not a sale. */
  PRICE_BID_ACCEPTED = 'PRICE_BID_ACCEPTED',
  PRICE_BID_DECLINED = 'PRICE_BID_DECLINED',
  /** It stood for BID_TTL_DAYS and nobody answered. */
  PRICE_BID_EXPIRED = 'PRICE_BID_EXPIRED',

  // --- money --------------------------------------------------------------
  /** A provider top-up cleared. `meta` carries amount and provider. */
  TOPUP_SUCCEEDED = 'TOPUP_SUCCEEDED',
  TOPUP_FAILED = 'TOPUP_FAILED',
  /** A promotion or VIP placement was charged. `meta` carries the tariff. */
  TARIFF_PAID = 'TARIFF_PAID',
  /** It is about to lapse — the one money event worth acting on in advance. */
  TARIFF_EXPIRING = 'TARIFF_EXPIRING',
}

/**
 * Kinds whose rows are collapsed per conversation rather than appended.
 *
 * Fifty messages in one thread is one claim on attention. The unique partial
 * index uq_notifications_unread_conversation enforces this in the database
 * too, so a race between two messages cannot produce two rows.
 */
export const CHAT_DEDUPE = true;

/** One page of the inbox. */
export const NOTIFICATIONS_PAGE = 30;

/**
 * How long a like keeps its own row.
 *
 * Liking, unliking and liking again is one event to the person on the other
 * end, and three rows in an inbox is how a feature teaches people to ignore
 * it. Inside this window an unread like from the same person about the same
 * video is simply not written again.
 */
export const LIKE_DEDUPE_HOURS = 24;
