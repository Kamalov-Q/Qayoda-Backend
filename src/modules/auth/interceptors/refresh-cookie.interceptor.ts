import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, map } from 'rxjs';
import { setRefreshCookie, wantsCookieAuth } from '../auth-cookie';

interface TokenPair {
  refreshToken?: string;
}

/**
 * Moves the refresh token out of the response body and into an httpOnly
 * cookie, for clients that asked for cookie auth.
 *
 * Applied once at the controller rather than per handler on purpose. Six
 * endpoints issue a token pair today — phone/verify, phone/login, password/
 * reset, google, telegram/poll and refresh — and the seventh will be added
 * by somebody who has never read this file. A per-handler call is a step
 * that gets forgotten, and forgetting it means the browser silently falls
 * back to holding a 30-day credential in JavaScript, which is the exact
 * failure this exists to prevent. An interceptor cannot be forgotten; it is
 * on the class.
 *
 * `delete body.refreshToken` is the other half and matters as much as the
 * cookie: leaving it in the JSON hands the token straight back to the script
 * the cookie was protecting it from.
 */
@Injectable()
export class RefreshCookieInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = ctx.switchToHttp();
    const req = http.getRequest<Request>();

    if (!wantsCookieAuth(req)) return next.handle();

    const res = http.getResponse<Response>();

    return next.handle().pipe(
      map((body: unknown) => {
        if (!body || typeof body !== 'object') return body;

        const pair = body as TokenPair;
        if (typeof pair.refreshToken !== 'string') return body;

        setRefreshCookie(res, pair.refreshToken);
        delete pair.refreshToken;
        return body;
      }),
    );
  }
}
