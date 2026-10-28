/**
 * How long a bid stands before it lapses.
 *
 * A number with no expiry is a liability: the seller comes back a month
 * later, taps Accept, and the buyer has long since bought something else.
 * Seven days is long enough for a weekend viewing and short enough that an
 * accepted bid still means something.
 */
export const BID_TTL_DAYS = 7;

/** One page of a bid list. Threads rarely run long; this is a ceiling. */
export const BIDS_PAGE = 50;

/**
 * The widest a bid may be relative to the asking price.
 *
 * Not a negotiating rule — a fat-finger guard. Bidding ABOVE asking is
 * allowed and happens on scarce stock, so the only ceiling is the one that
 * catches a missing decimal point.
 */
export const MAX_BID_MULTIPLE = 10;

/**
 * How many bids one person may place on one listing per day.
 *
 * Each bid writes a message into the seller's thread and rings their phone,
 * so this is a politeness limit as much as an abuse one. Withdrawing and
 * re-bidding to nudge somebody is exactly the behaviour it stops.
 */
export const MAX_BIDS_PER_LISTING_PER_DAY = 5;
