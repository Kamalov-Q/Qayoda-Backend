import {
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client, TokenPayload } from 'google-auth-library';
import { AuthProvider, UserStatus } from 'src/shared/enums';
import { IdentityService } from './identity.service';
import { TokenService } from './token.service';

@Injectable()
export class GoogleAuthService {
  private readonly logger = new Logger(GoogleAuthService.name);
  private readonly client = new OAuth2Client();
  private readonly audiences: string[];

  constructor(
    config: ConfigService,
    private readonly identities: IdentityService,
    private readonly tokens: TokenService,
  ) {
    // Each platform gets its own OAuth client id; all are valid audiences.
    this.audiences = [
      config.get<string>('GOOGLE_CLIENT_ID_ANDROID'),
      config.get<string>('GOOGLE_CLIENT_ID_IOS'),
      config.get<string>('GOOGLE_CLIENT_ID_WEB'),
    ].filter((id): id is string => !!id);

    // Fail at boot, not at the first sign-in. With an empty list the audience
    // check has nothing to match and every Google login 401s with a message
    // that points at the token rather than at the missing config.
    if (this.audiences.length === 0) {
      throw new Error(
        'Set at least one of GOOGLE_CLIENT_ID_ANDROID / _IOS / _WEB',
      );
    }
  }

  /**
   * The client sends Google's ID token; we verify it against Google's public
   * keys. Never trust an email the client sends directly — only what comes out
   * of a signature-verified token.
   */
  private async verify(idToken: string): Promise<TokenPayload> {
    try {
      const ticket = await this.client.verifyIdToken({
        idToken,
        audience: this.audiences,
      });
      const payload = ticket.getPayload();
      if (!payload?.sub) throw new Error('No subject in Google token');
      return payload;
    } catch (e) {
      this.logger.warn(
        `Google token verification failed: ${(e as Error).message}`,
      );
      throw new UnauthorizedException({ code: 'GOOGLE_TOKEN_INVALID' });
    }
  }

  async signIn(idToken: string, lang: 'uz' | 'ru' = 'uz') {
    const p = await this.verify(idToken);

    const { user, isNew } = await this.identities.resolve({
      provider: AuthProvider.GOOGLE,
      providerId: p.sub,
      // Auto-link only when Google confirms the address — an unverified email
      // on a Google account proves nothing.
      verifiedEmail: p.email_verified ? (p.email ?? null) : null,
      name: p.name ?? null,
      avatarUrl: p.picture ?? null,
      language: lang,
      profile: { email: p.email, locale: p.locale },
    });

    if (user.status === UserStatus.BANNED) {
      throw new ForbiddenException({ code: 'ACCOUNT_BANNED' });
    }

    return { ...(await this.tokens.issuePair(user)), isNew };
  }

  async link(userId: string, idToken: string) {
    const p = await this.verify(idToken);
    await this.identities.link(userId, {
      provider: AuthProvider.GOOGLE,
      providerId: p.sub,
      verifiedEmail: p.email_verified ? (p.email ?? null) : null,
      name: p.name ?? null,
      avatarUrl: p.picture ?? null,
      profile: { email: p.email },
    });
    return { linked: true };
  }
}
