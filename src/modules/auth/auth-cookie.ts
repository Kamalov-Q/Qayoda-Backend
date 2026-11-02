import type { Request, Response } from 'express';

/**
 * Refresh-token cookies, for browser clients only.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 *
 * The mobile app keeps its refresh token in the Keychain / Keystore via
 * expo-secure-store and sends it in the request body. That is safe there
 * because no other code on the device can read it.
 *
 * The browser has no equivalent. Anything JavaScript can read, an injected
 * script can read — so a 30-day refresh token in localStorage is a 30-day
 * session handed to the first XSS. `secure-session.web.ts` in the mobile
 * repo has said so in a comment since it was written; that comment was
 * acceptable while web was a dev convenience and is not now that the web app
 * is a product.
 *
 * An httpOnly cookie is the one storage a browser has that script cannot
 * read. It is not a nicety: it is the difference between "an XSS defaces a
 * page" and "an XSS takes over the account for a month".
 *
 * ── Why SameSite=Lax is enough here ────────────────────────────────────────
 *
 * The site is growencity.uz and the API is api.growencity.uz. Different
 * ORIGINS, but the same SITE — SameSite compares the registrable domain, so
 * a Lax cookie scoped to `.growencity.uz` IS sent on the web app's calls to
 * the API, while a form post or image tag from an attacker's domain gets
 * nothing. SameSite=None would be required only if the two lived on
 * unrelated domains, and None is strictly weaker.
 *
 * ── Why Path is narrowed ───────────────────────────────────────────────────
 *
 * The refresh token is only ever presented to /api/auth/refresh and cleared
 * by /api/auth/logout. Scoping the cookie to that path keeps it off every
 * other request in the app — listings, chat, uploads — so the credential is
 * simply not present in the overwhelming majority of traffic.
 */

export const REFRESH_COOKIE = 'gc_rt';

/** Mirrors REFRESH_TTL_MS in token.service.ts. */
const MAX_AGE_MS = 30 * 86_400_000;

/**
 * Browser clients opt in with this header.
 *
 * Explicit rather than sniffed. The alternative — deciding from the Origin
 * header — means a change in how React Native sets Origin silently starts
 * sending Set-Cookie to phones, and a subtle auth bug on a shipped app is
 * the worst kind. A client that wants cookie auth says so.
 */
export const COOKIE_MODE_HEADER = 'x-auth-mode';

export const wantsCookieAuth = (req: Request): boolean =>
  req.headers[COOKIE_MODE_HEADER] === 'cookie';

function baseOptions() {
  const isProd = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    // Secure in production only: a Secure cookie is dropped over plain http,
    // which would make local development silently impossible to debug.
    secure: isProd,
    sameSite: 'lax' as const,
    path: '/api/auth',
    // Shared between the site and the API subdomain. Unset in development,
    // where the host is localhost and a Domain attribute would be rejected.
    ...(isProd && process.env.COOKIE_DOMAIN
      ? { domain: process.env.COOKIE_DOMAIN }
      : {}),
  };
}

export function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE, token, {
    ...baseOptions(),
    maxAge: MAX_AGE_MS,
  });
}

/**
 * Clearing must repeat the SAME attributes it was set with.
 *
 * A browser matches a deletion against name + domain + path; get any of them
 * wrong and the old cookie survives, so "log out" leaves a working refresh
 * token in the browser. This is the commonest way a logout silently fails.
 */
export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, baseOptions());
}

/** The token a browser presented, if any. */
export const refreshCookieFrom = (req: Request): string | undefined =>
  (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
