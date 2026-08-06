import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { IsNull } from 'typeorm';
import { VerificationTokenRepository } from './repositories/verification-token.repository';
import { OtpPurpose } from '../otp/enums/otp-purpose.enum';

const VERIFICATION_TTL_MS = 15 * 60 * 1000;

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly verificationTokens: VerificationTokenRepository,
  ) {}

  async signVerification(email: string, purpose: OtpPurpose) {
    const row = await this.verificationTokens.save(
      this.verificationTokens.create({
        email,
        purpose,
        expiresAt: new Date(Date.now() + VERIFICATION_TTL_MS),
      }),
    );
    return this.jwt.sign(
      { jti: row.id },
      {
        secret: this.config.getOrThrow<string>('JWT_VERIFICATION_SECRET'),
        expiresIn: '15m',
      },
    );
  }

  async consumeVerification(
    token: string,
    expectedPurpose: OtpPurpose,
  ): Promise<{ email: string }> {
    const { jti } = this.tryVerify<{ jti: string }>(
      token,
      'JWT_VERIFICATION_SECRET',
    );

    const row = await this.verificationTokens.findOneBy({ id: jti });
    if (!row) throw new UnauthorizedException('Token invalid or expired');
    if (row.expiresAt < new Date())
      throw new UnauthorizedException('Token expired');
    if (row.purpose !== expectedPurpose)
      throw new UnauthorizedException('Token does not match this action');

    // Claiming the token IS the check: a plain read-then-write lets two
    // concurrent requests both pass and spend a single-use token twice.
    const claimed = await this.verificationTokens.update(
      { id: jti, consumedAt: IsNull() },
      { consumedAt: new Date() },
    );
    if (claimed.affected !== 1)
      throw new UnauthorizedException('Token already used');

    return { email: row.email };
  }

  /** `tokenId` is the refresh-token row this session belongs to, so that
   *  logout can revoke exactly this session. */
  signAccess(userId: string, email: string, tokenId: string) {
    return this.jwt.sign(
      { sub: userId, email, jti: tokenId },
      {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        expiresIn: '15m',
      },
    );
  }

  signRefresh(userId: string, tokenId: string) {
    return this.jwt.sign(
      { sub: userId, jti: tokenId },
      {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
        expiresIn: '30d',
      },
    );
  }

  private tryVerify<T extends object>(token: string, secretKey: string): T {
    try {
      return this.jwt.verify<T>(token, {
        secret: this.config.getOrThrow<string>(secretKey),
      });
    } catch {
      throw new UnauthorizedException('Token invalid or expired');
    }
  }
}
