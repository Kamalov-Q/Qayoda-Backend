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
}

/** Request that passed JwtAccessGuard — Passport has populated `user`. */
export interface AuthenticatedRequest<P = Request['params']>
  extends Request<P> {
  user?: AuthUser;
}
