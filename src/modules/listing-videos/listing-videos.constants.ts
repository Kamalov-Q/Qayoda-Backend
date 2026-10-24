/**
 * The life of a listing's tour film.
 *
 * Three states, not six. A reel's lifecycle is long because a reel is a
 * PURCHASE — it can be encoded but unpaid, paid but later taken down, and
 * every one of those needs a name so the money can be explained. A tour is
 * part of an advert that has already been paid for: it either plays, or it
 * is still encoding, or it never will.
 */
export enum ListingVideoStatus {
  /** Bunny object created; the phone is uploading or Bunny is encoding. */
  UPLOADING = 'UPLOADING',
  /** Encoded, within the limit, playable. */
  READY = 'READY',
  /** Too long, encoding failed, or the upload was abandoned. */
  FAILED = 'FAILED',
}

export enum ListingVideoFailReason {
  TOO_LONG = 'TOO_LONG',
  ENCODING_FAILED = 'ENCODING_FAILED',
  ABANDONED = 'ABANDONED',
}

/**
 * Three minutes, where a reel gets one.
 *
 * Different limit because it is a different job. A reel has to stop a thumb
 * mid-scroll, and sixty seconds is already generous for that. A tour is
 * watched on purpose by somebody deciding whether to visit, and a two-bedroom
 * flat cannot be walked through in a minute without the camera running.
 */
export const LISTING_VIDEO_MAX_DURATION_SEC = 180;
/** Phones round a 180.4 s recording to "3:00"; refusing it would be pedantry. */
export const LISTING_VIDEO_DURATION_SLACK_SEC = 2;

/** Signed upload ticket lifetime — long enough for a tour over 3G. */
export const LISTING_VIDEO_UPLOAD_TTL_SEC = 2 * 60 * 60;
/** UPLOADING longer than this → ask Bunny what actually happened. */
export const LISTING_VIDEO_RESYNC_AFTER_MIN = 15;
/** Still UPLOADING after this → the phone never finished. */
export const LISTING_VIDEO_ABANDON_HOURS = 24;
