/**
 * The social accounts a profile can advertise.
 *
 * A fixed list rather than free-form links: the app draws one icon per
 * platform, and "any URL" would mean rendering a generic chain link for
 * whatever somebody pasted — including things nobody should be clicking from
 * inside the app.
 */
export const SOCIAL_PLATFORMS = [
  'tiktok',
  'instagram',
  'facebook',
  'x',
  'threads',
  'whatsapp',
] as const;

export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

/** What a profile stores: platform → handle or full URL, as given. */
export type SocialLinks = Partial<Record<SocialPlatform, string>>;

/**
 * The answers offered. Gender is optional everywhere — declining to say is
 * expressed by leaving it null, not by a third option.
 *
 * The column is a plain varchar with no CHECK, so this list is the only thing
 * enforcing the set: anything dropped from it is refused by the DTO on the
 * next write, while rows already holding it keep reading back fine.
 */
export const GENDERS = ['MALE', 'FEMALE'] as const;
export type Gender = (typeof GENDERS)[number];

/** Nobody is 120, and nobody trading property is 5. */
export const MIN_AGE = 14;
export const MAX_AGE = 110;

/** One handle, one bio — long enough to be useful, short enough to render. */
export const SOCIAL_HANDLE_MAX = 200;
export const BIO_MAX = 500;
export const ADDRESS_MAX = 255;

/** Whole years between a birth date and today. */
export function ageFrom(birthDate: Date | string | null): number | null {
  if (!birthDate) return null;

  const born = new Date(birthDate);
  if (Number.isNaN(born.getTime())) return null;

  const today = new Date();
  let age = today.getUTCFullYear() - born.getUTCFullYear();

  // Not had this year's birthday yet.
  const monthDiff = today.getUTCMonth() - born.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getUTCDate() < born.getUTCDate())) {
    age -= 1;
  }

  return age;
}
