import type { Request } from 'express';

/**
 * Shape returned by JwtAccessStrategy.validate() — Passport attaches it to
 * req.user, and @CurrentUser() hands it to controllers.
 */
export interface AuthUser {
  userId: string;
  email: string;
  tokenId: string;
}

/** Request that passed JwtAccessGuard — Passport has populated `user`. */
export interface AuthenticatedRequest<
  P = Request['params'],
> extends Request<P> {
  user?: AuthUser;
}
