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
  cachedAt: number;
}

interface AccountRow {
  status: UserStatus;
  role: UserRole;
  deleted_at: Date | null;
  ban_reason: string | null;
  ban_expires_at: Date | null;
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
      user?: { sub?: string; role?: UserRole };
    }>();
    const userId = req.user?.sub;
    if (!userId) throw new UnauthorizedException();

    const state = await JwtAccessGuard.getState(this.ds, userId);

    if (state.deletedAt) {
      throw new UnauthorizedException({ code: 'ACCOUNT_DELETED' });
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
      `SELECT status, role, deleted_at, ban_reason, ban_expires_at
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
      cachedAt: Date.now(),
    };
    this.cache.set(userId, state);
    return state;
  }

  /** Call from ban / unban / role-change so the change takes effect at once. */
  static invalidate(userId: string): void {
    this.cache.delete(userId);
  }
}
