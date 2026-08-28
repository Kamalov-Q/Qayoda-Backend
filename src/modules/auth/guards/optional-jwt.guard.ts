import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { AuthUser } from '../types/auth-user.type';

/**
 * Attaches req.user when a token is present, does nothing when it isn't.
 * Never throws — this is what lets guests browse listings.
 *
 * It deliberately skips the account-state lookup JwtAccessGuard does: routes
 * behind this guard are public, so a banned user reading them is the same as
 * a signed-out one reading them.
 */
@Injectable()
export class OptionalJwtGuard extends AuthGuard('jwt') {
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    try {
      await super.canActivate(ctx);
    } catch {
      // no token / expired — stay anonymous
    }
    return true;
  }

  handleRequest<TUser = AuthUser | null>(_err: unknown, user: unknown): TUser {
    return (user || null) as TUser;
  }
}
