import type { Request } from 'express';
import type { UserRole } from 'src/shared/enums';

/**
 * The access-token payload, and the shape JwtStrategy.validate() attaches to
 * `req.user`. `sub` is the user id — the same claim name the token carries, so
 * there is one spelling for it end to end.
 *
 * `role` is re-read from the database by JwtAccessGuard on every request, so a
 * demotion applies immediately rather than at the next token refresh.
 */
export interface AuthUser {
  sub: string;
  role: UserRole;
  /**
   * Issued-at, in SECONDS (the JWT standard unit, not milliseconds).
   *
   * Carried through so JwtAccessGuard can compare it against the account's
   * `tokens_valid_from` and reject tokens minted before a logout. Optional
   * because a token issued before this field was read still verifies — those
   * simply skip the check rather than being rejected, which is the right way
   * round for a change that ships while people are signed in.
   */
  iat?: number;
}

/** Request that passed JwtAccessGuard — Passport has populated `user`. */
export interface AuthenticatedRequest<P = Request['params']>
  extends Request<P> {
  user?: AuthUser;
}
