import {
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { DataSource } from 'typeorm';
import { UserRole, UserStatus } from 'src/shared/enums';

interface AccountState {
  status: UserStatus;
  role: UserRole;
  deletedAt: Date | null;
  banReason: string | null;
  banExpiresAt: Date | null;
  /** Whether a verified phone is on the account — see PhoneRequiredGuard. */
  hasPhone: boolean;
  /** Tokens issued before this are dead. Null = never revoked. */
  tokensValidFrom: Date | null;
  cachedAt: number;
}

interface AccountRow {
  status: UserStatus;
  role: UserRole;
  deleted_at: Date | null;
  ban_reason: string | null;
  ban_expires_at: Date | null;
  phone_number: string | null;
  tokens_valid_from: Date | null;
}

/**
 * This is what makes `status` mean anything. Without the DB check, a banned
 * user keeps working for the remaining 15 minutes of their access token,
 * including their open chat socket.
 */
@Injectable()
export class JwtAccessGuard extends AuthGuard('jwt') {
  private static readonly TTL_MS = 30_000;

  /**
   * Static so every module that lists this guard in `@UseGuards` shares one
   * cache. Nest builds a separate instance per injector, and a per-instance
   * cache would leave `invalidate()` clearing only one of them.
   */
  private static readonly cache = new Map<string, AccountState>();

  constructor(private readonly ds: DataSource) {
    super();
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const ok = (await super.canActivate(ctx)) as boolean;
    if (!ok) return false;

    const req = ctx.switchToHttp().getRequest<{
      user?: { sub?: string; role?: UserRole; iat?: number };
    }>();
    const userId = req.user?.sub;
    if (!userId) throw new UnauthorizedException();

    const state = await JwtAccessGuard.getState(this.ds, userId);

    if (state.deletedAt) {
      throw new UnauthorizedException({ code: 'ACCOUNT_DELETED' });
    }

    // Issued before the account last revoked its sessions? Then this token
    // belongs to a session that has been logged out, and a signature that
    // still verifies does not make it live.
    //
    // Compared at ONE-SECOND resolution, which is the resolution `iat` has.
    //
    // The first version compared `iat * 1000` against the millisecond
    // timestamp, and that is wrong in a way that only shows up in the most
    // ordinary flow there is: log out at 06:19:45.489, sign straight back
    // in at .6, and the new token's `iat` floors to 06:19:45.000 — before
    // the revocation. The fresh token was rejected, the client refreshed,
    // failed, and bounced to the login screen it had just come from.
    //
    // Flooring the boundary instead means tokens issued in the SAME SECOND
    // as the logout are honoured, including the few hundred milliseconds of
    // them that preceded it. That is a sub-second window on a mechanism
    // whose whole purpose is to replace a fifteen-MINUTE one, and it is the
    // right way to be wrong: being conservative here breaks signing back in,
    // which people do constantly, to close a hole measured in milliseconds,
    // which nobody can exploit.
    //
    // A token with no `iat` predates this check; it is allowed through
    // rather than rejected, so shipping this does not sign out everybody
    // who is currently signed in.
    if (state.tokensValidFrom && req.user?.iat !== undefined) {
      const boundarySeconds = Math.floor(state.tokensValidFrom.getTime() / 1000);
      if (req.user.iat < boundarySeconds) {
        throw new UnauthorizedException({ code: 'TOKEN_REVOKED' });
      }
    }
    if (JwtAccessGuard.isBanned(state)) {
      throw new ForbiddenException({
        code: 'ACCOUNT_BANNED',
        reason: state.banReason,
        until: state.banExpiresAt,
      });
    }

    // Trust the DB over the token for role, so a demotion lands immediately.
    req.user!.role = state.role;
    return true;
  }

  /** A temporary ban that has run out is no ban, with or without a sweeper job. */
  private static isBanned(state: AccountState): boolean {
    if (state.status !== UserStatus.BANNED) return false;
    return !state.banExpiresAt || state.banExpiresAt > new Date();
  }

  private static async getState(
    ds: DataSource,
    userId: string,
  ): Promise<AccountState> {
    const hit = this.cache.get(userId);
    if (hit && Date.now() - hit.cachedAt < this.TTL_MS) return hit;

    const rows = await ds.query<AccountRow[]>(
      `SELECT status, role, deleted_at, ban_reason, ban_expires_at,
              phone_number, tokens_valid_from
         FROM users
        WHERE id = $1`,
      [userId],
    );
    if (!rows.length) throw new UnauthorizedException();

    const state: AccountState = {
      status: rows[0].status,
      role: rows[0].role,
      deletedAt: rows[0].deleted_at,
      banReason: rows[0].ban_reason,
      banExpiresAt: rows[0].ban_expires_at,
      hasPhone: !!rows[0].phone_number,
      tokensValidFrom: rows[0].tokens_valid_from,
      cachedAt: Date.now(),
    };
    this.cache.set(userId, state);
    return state;
  }

  /**
   * Does this account have a verified phone? Answered from the same cached
   * row this guard already reads, so the phone gate costs no extra query.
   *
   * Public and static so PhoneRequiredGuard can ask without depending on
   * guard ordering or on what the previous guard left on the request.
   */
  static async hasPhone(ds: DataSource, userId: string): Promise<boolean> {
    return (await this.getState(ds, userId)).hasPhone;
  }

  /** Call from ban / unban / role-change / phone-link so the change takes
   *  effect at once. */
  static invalidate(userId: string): void {
    this.cache.delete(userId);
  }
}
