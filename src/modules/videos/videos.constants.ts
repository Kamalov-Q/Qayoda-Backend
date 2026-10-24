/**
 * The life of a video.
 *
 * Nothing is charged before READY, and nothing becomes public without being
 * charged — those two sentences are the whole payment design, and every state
 * here exists to keep them true when an upload dies halfway, a phone lies
 * about a clip's length, or a wallet is empty at the wrong moment.
 */
export enum VideoStatus {
  /** Bunny object created; the phone is uploading or Bunny is encoding. */
  UPLOADING = 'UPLOADING',
  /** Encoded and within the limit, but the wallet could not pay VIDEO_POST. */
  AWAITING_PAYMENT = 'AWAITING_PAYMENT',
  /** Paid and public. */
  READY = 'READY',
  /** Too long, encoding failed, or abandoned. Never charged. */
  FAILED = 'FAILED',
  /** AWAITING_PAYMENT that was never paid for. Never charged. */
  EXPIRED = 'EXPIRED',
  /** Taken down by the author or an admin. */
  REMOVED = 'REMOVED',
}

export enum VideoFailReason {
  TOO_LONG = 'TOO_LONG',
  ENCODING_FAILED = 'ENCODING_FAILED',
  ABANDONED = 'ABANDONED',
}

/** Status numbers in a Bunny WEBHOOK body. */
export const BUNNY_WEBHOOK_STATUS = {
  FINISHED: 3,
  RESOLUTION_FINISHED: 4,
  FAILED: 5,
  PRESIGNED_UPLOAD_FAILED: 8,
} as const;

/** Status numbers on a Bunny VIDEO OBJECT (GET /videos/{id}) — a different list. */
export const BUNNY_VIDEO_STATUS = {
  FINISHED: 4,
  ERROR: 5,
  UPLOAD_FAILED: 6,
} as const;

/** The product rule: a reel is a minute at most. */
export const VIDEO_MAX_DURATION_SEC = 60;
/** Phones round a 60.4 s recording to "1:00"; refusing it would be pedantry. */
export const VIDEO_DURATION_SLACK_SEC = 1;

export const VIDEO_UPLOAD_TTL_SEC = 2 * 60 * 60; // signed upload ticket lifetime
export const VIDEO_ABANDON_HOURS = 24; // UPLOADING longer than this → FAILED
export const VIDEO_AWAITING_PAYMENT_HOURS = 48; // then → EXPIRED
export const VIDEO_RESYNC_AFTER_MIN = 15; // UPLOADING this long → ask Bunny
/** A removed video keeps its record this long before the file is deleted. */
export const VIDEO_RETENTION_DAYS = 30;

/** Per author, per rolling day. Everyone may post, so this is the brake. */
export const VIDEO_DAILY_LIMIT = 10;

export const VIDEO_FEED_MAX = 20;
export const VIDEO_CAPTION_MAX = 2200;
export const VIDEO_COMMENT_MAX = 1000;

/**
 * How much of a head start a video gets in the feed for pointing at a
 * listing, in hours.
 *
 * This is the whole ranking "algorithm" at this size, and it is a time bonus
 * rather than a score so that the feed can still be keyset-paged on one
 * indexed column (see Video.rankAt). A reel that sells a flat outranks a
 * same-day reel that sells nothing, and by tomorrow both are old news —
 * which is the right shape for a marketplace.
 */
export const LISTING_LINK_BOOST_HOURS = 6;

/** Watch at least this long before it counts as a view. */
export const VIEW_MIN_WATCH_MS = 3000;
/** How many views one batched report may carry. */
export const VIEW_BATCH_MAX = 50;

/**
 * Why a video can be reported.
 *
 * Its own list, not the listing one: a reel is flagged for what it shows, not
 * for what an advert claims — so "already sold" and "wrong price" are gone,
 * and COPYRIGHT is here because a soundtrack somebody does not own is the
 * single most likely takedown request this feature will ever receive.
 */
export const VIDEO_REPORT_REASONS = [
  /** Not a property video at all: advertising, repeated junk. */
  'SPAM',
  /** Scam attempt: fake viewings, advance payments. */
  'FRAUD',
  /** The video does not show what it claims to show. */
  'WRONG_INFO',
  /** Offensive, explicit or violent content. */
  'INAPPROPRIATE',
  /** Music or footage the poster does not own. */
  'COPYRIGHT',
  /** Anything else — requires the free-text comment. */
  'OTHER',
] as const;
export type VideoReportReason = (typeof VIDEO_REPORT_REASONS)[number];

export const VIDEO_REPORT_STATUSES = ['OPEN', 'RESOLVED', 'DISMISSED'] as const;
export type VideoReportStatus = (typeof VIDEO_REPORT_STATUSES)[number];

/**
 * How many followers hear about a new reel.
 *
 * An inbox needs a row per person, so a popular author posting is a write
 * amplification problem. Past this the Following feed carries it instead —
 * it resolves the same relationship on read and is complete by construction.
 */
export const FOLLOWER_FANOUT_CAP = 500;
