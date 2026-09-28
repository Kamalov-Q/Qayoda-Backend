/**
 * The dials behind a listing's rating. Gathered here because these numbers
 * ARE the policy — changing one changes what the whole marketplace means by
 * "4.6", and that decision should not be buried in a SQL string.
 */

/**
 * Where every listing starts, and what a thin record is pulled back towards.
 *
 * Five, deliberately: a listing nobody has rated is not a bad listing, and a
 * marketplace that shows new sellers a blank or a zero gives them nothing to
 * protect. They begin trusted and spend that trust.
 */
export const PRIOR = 5;

/**
 * How much the prior weighs, in reviews.
 *
 * Three imaginary five-star reviews sit under every listing. One furious
 * one-star lands at 4.0 rather than 1.0; ten of them reach 1.9. This is the
 * shrinkage that stops a single voice — or a single rival — from deciding
 * what a listing is worth, and it is why a listing with 40 reviews at 4.6
 * outranks one with 2 reviews at 5.0.
 */
export const PRIOR_WEIGHT = 3;

/**
 * How long a review keeps half its say.
 *
 * A year. What someone thought of a flat in 2023 is evidence about 2023; the
 * listing may have been repainted, or relet by a different agent since. Old
 * opinions fade rather than vanish — see DECAY_FLOOR.
 */
export const HALF_LIFE_DAYS = 365;

/**
 * The least a vote can decay to. Without a floor a four-year-old review is
 * worth 6% of a new one, which is indistinguishable from deleting it — and a
 * marketplace that quietly deletes criticism is not one anybody should trust.
 */
export const DECAY_FLOOR = 0.25;

/** What an upheld report counts as, in stars. The worst thing anyone can say. */
export const REPORT_STARS = 1;

/**
 * What an upheld report against THIS listing weighs, in reviews.
 *
 * Three: heavier than any single review, because a moderator agreed with it.
 * A fake advert is not "one person's opinion" — it is a fact about the
 * listing that a human checked.
 */
export const REPORT_LISTING_WEIGHT = 3;

/**
 * What an upheld report against the SELLER weighs on each of their other
 * listings.
 *
 * One: their record follows them, but a single bad advert does not condemn
 * everything else they have posted. Chat reports count here too — someone
 * abusive in messages is a risk to deal with whichever advert you found them
 * through.
 */
export const REPORT_OWNER_WEIGHT = 1;

/**
 * The most a seller's own record can weigh on one listing, in reviews.
 *
 * Six. Past that a seller with a long history would have every listing pinned
 * at the floor no matter what buyers actually said about each one, and the
 * rating would stop being about the listing at all. Banning is the tool for
 * "this person should not be here"; a rating is not a punishment queue.
 */
export const REPORT_OWNER_CAP = 6;

/** Ratings never leave the star range, whatever the arithmetic says. */
export const MIN_RATING = 1;
export const MAX_RATING = 5;
