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
}

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
