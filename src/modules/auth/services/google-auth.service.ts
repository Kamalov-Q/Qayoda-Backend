import {
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
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

    // Unconfigured means this provider is OFF, not that the server is broken.
    //
    // This used to throw here. That reads well — fail at boot, not at the
    // first sign-in — but it makes an OPTIONAL provider able to take the
    // whole API down: removing the Google ids (unused, since the app signs in
    // with PHONE and TELEGRAM) left Nest unable to construct this service, so
    // every request answered 502 while pm2 restarted it in a loop.
    //
    // Same rule as the payment providers, which register only when they have
    // credentials: no ids, no Google sign-in, everything else keeps serving.
    if (this.audiences.length === 0) {
      this.logger.warn(
        'Google sign-in is DISABLED: none of GOOGLE_CLIENT_ID_ANDROID / _IOS / _WEB is set',
      );
    }
  }

  /**
   * Refused at the endpoint instead, where the message can say what is
   * actually wrong. An empty audience list would otherwise 401 every token
   * and point the blame at the client.
   */
  private assertConfigured(): void {
    if (this.audiences.length === 0) {
      throw new ServiceUnavailableException({
        code: 'GOOGLE_NOT_CONFIGURED',
        message: 'Google sign-in is not configured on this server',
      });
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
    this.assertConfigured();
    const p = await this.verify(idToken);

    const { user, isNew } = await this.identities.resolve({
      provider: AuthProvider.GOOGLE,
      providerId: p.sub,
      // Auto-link only when Google confirms the address — an unverified email
      // on a Google account proves nothing.
      verifiedEmail: p.email_verified ? (p.email ?? null) : null,
      // given/family, not the joined display name — they map onto the
      // profile's name + surname and spare a Google user the onboarding form.
      name: p.given_name ?? p.name ?? null,
      surname: p.family_name ?? null,
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
    this.assertConfigured();
    const p = await this.verify(idToken);
    await this.identities.link(userId, {
      provider: AuthProvider.GOOGLE,
      providerId: p.sub,
      verifiedEmail: p.email_verified ? (p.email ?? null) : null,
      name: p.given_name ?? p.name ?? null,
      surname: p.family_name ?? null,
      avatarUrl: p.picture ?? null,
      profile: { email: p.email },
    });
    return { linked: true };
  }
}
