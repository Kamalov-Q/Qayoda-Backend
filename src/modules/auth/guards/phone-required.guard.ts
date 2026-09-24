import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { JwtAccessGuard } from './jwt-access.guard';

/**
 * Requires a verified phone number on top of a session.
 *
 * Telegram and Google vouch for an identity but not for a reachable Uzbek
 * number, so an account created through either can exist with no phone at
 * all. That is fine for reading and for private actions like saving a
 * listing — but not for the ones other people have to live with: posting a
 * listing, reviewing one, reporting, opening a chat. Those need someone
 * answerable at a number that cost an SMS to prove.
 *
 * Always used *after* JwtAccessGuard, which is what puts `sub` on the
 * request; the phone itself comes from that guard's cached account row, so
 * this adds no query of its own.
 */
@Injectable()
export class PhoneRequiredGuard implements CanActivate {
  constructor(private readonly ds: DataSource) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<{ user?: { sub?: string } }>();
    const userId = req.user?.sub;
    if (!userId) throw new UnauthorizedException();

    if (await JwtAccessGuard.hasPhone(this.ds, userId)) return true;

    // A distinct code, not a generic 403: the app turns this one into the
    // "add your number" flow rather than an error toast.
    throw new ForbiddenException({
      code: 'PHONE_REQUIRED',
      message: 'Bu amal uchun telefon raqamingizni tasdiqlang',
    });
  }
}
