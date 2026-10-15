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

/** What a profile stores: platform → bare handle (digits for WhatsApp). */
export type SocialLinks = Partial<Record<SocialPlatform, string>>;

/** The hosts each platform is known by, for recognising a pasted link. */
const SOCIAL_HOSTS: Record<SocialPlatform, RegExp> = {
  tiktok: /^(www\.)?tiktok\.com$/i,
  instagram: /^(www\.)?instagram\.com$/i,
  facebook: /^(www\.)?(facebook\.com|fb\.com|fb\.me)$/i,
  x: /^(www\.)?(x\.com|twitter\.com)$/i,
  threads: /^(www\.)?(threads\.net|threads\.com)$/i,
  whatsapp: /^(www\.|api\.)?(wa\.me|whatsapp\.com)$/i,
};

/** Local mobile numbers are nine digits here; wa.me needs the country code. */
const UZ_DIALING_CODE = '998';
const UZ_LOCAL_DIGITS = 9;

/**
 * One account, written the one way.
 *
 * Mirrors normalizeSocial() in the app. It runs here too because the app is
 * not the only writer — the dashboard and anything else holding a token post
 * to the same endpoint, and a value that reaches the column unnormalised is
 * one the renderer has to keep guessing about forever.
 *
 * `@name`, `name`, `https://instagram.com/name` and `instagram.com/name` all
 * become `name`. Returns '' when nothing usable is left.
 */
export function normalizeSocialHandle(
  platform: SocialPlatform,
  raw: string,
): string {
  let value = raw.trim();
  if (!value) return '';

  // A pasted link, with or without a scheme. The slash is required so a
  // handle that merely contains a dot ("john.doe") is left alone.
  const asUrl = /^(?:https?:\/\/)?([a-z0-9.-]+\.[a-z]{2,})\/(.*)$/i.exec(value);
  if (asUrl && SOCIAL_HOSTS[platform].test(asUrl[1])) {
    // wa.me puts the number in the path, api.whatsapp.com in the query.
    const phone = /[?&]phone=(\d+)/i.exec(value);
    value = phone ? phone[1] : asUrl[2];
  }

  value = value.split(/[?#]/)[0].replace(/\/+$/, '');

  if (platform === 'whatsapp') {
    const digits = value.replace(/\D/g, '');
    return digits.length === UZ_LOCAL_DIGITS
      ? `${UZ_DIALING_CODE}${digits}`
      : digits;
  }

  return value.replace(/^@+/, '');
}

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
