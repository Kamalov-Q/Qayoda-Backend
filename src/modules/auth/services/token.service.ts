import {
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { IsNull, LessThan, Repository } from 'typeorm';
import { createHash, randomBytes } from 'crypto';
import { User } from 'src/modules/users/entities/user.entity';
import { UserStatus } from 'src/shared/enums';
import { RefreshToken } from '../entities/refresh-token.entity';

const ACCESS_TTL = '15m';
const REFRESH_TTL_MS = 30 * 86_400_000;

@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);

  constructor(
    @InjectRepository(RefreshToken)
    private readonly refreshes: Repository<RefreshToken>,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async issuePair(user: User, familyId?: string) {
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, role: user.role },
      {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        expiresIn: ACCESS_TTL,
      },
    );

    const raw = randomBytes(48).toString('base64url');
    const family = familyId ?? randomBytes(16).toString('hex');

    await this.refreshes.save(
      this.refreshes.create({
        userId: user.id,
        familyId: family,
        tokenHash: this.hash(raw),
        expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
      }),
    );

    return {
      accessToken,
      refreshToken: `${family}.${raw}`,
      user: {
        id: user.id,
        name: user.name,
        surname: user.surname,
        phoneNumber: user.phoneNumber,
        email: user.email,
        avatarUrl: user.avatarUrl,
        language: user.language,
        role: user.role,
        isVerifiedRealtor: user.isVerifiedRealtor,
      },
    };
  }

  /** Rotation with reuse detection — a replayed token kills the whole family. */
  async rotate(presented: string) {
    const [familyId, raw] = presented.split('.');
    if (!familyId || !raw) throw new UnauthorizedException();

    const row = await this.refreshes.findOne({
      where: { familyId, tokenHash: this.hash(raw) },
      relations: { user: true },
    });

    // A hash that was never issued in this family: either a forgery or a token
    // from a family that has since been purged. Nothing here is safe to trust.
    if (!row) throw new UnauthorizedException({ code: 'TOKEN_INVALID' });

    // The real replay signal. A rotated token stays in the table with
    // `revokedAt` set, so seeing one presented again means two parties hold
    // tokens from this chain — burn the family and make both sign in.
    if (row.revokedAt) {
      await this.revokeFamily(familyId);
      this.logger.warn(`Refresh token reuse on family ${familyId}; revoked`);
      throw new UnauthorizedException({ code: 'TOKEN_REUSE_DETECTED' });
    }

    if (row.expiresAt < new Date()) {
      throw new UnauthorizedException({ code: 'TOKEN_EXPIRED' });
    }

    // Claiming the row IS the check. A read-then-write let two concurrent
    // refreshes both pass the checks above and walk away with a live session
    // each, which is exactly the state reuse detection exists to prevent.
    const claimed = await this.refreshes.update(
      { id: row.id, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
    if (claimed.affected !== 1) {
      await this.revokeFamily(familyId);
      throw new UnauthorizedException({ code: 'TOKEN_REUSE_DETECTED' });
    }

    // The join drops soft-deleted users, so a null user means the account went
    // away while its tokens did not.
    if (!row.user) {
      throw new UnauthorizedException({ code: 'ACCOUNT_DELETED' });
    }
    if (row.user.status === UserStatus.BANNED) {
      await this.revokeAllFor(row.userId);
      throw new ForbiddenException({ code: 'ACCOUNT_BANNED' });
    }

    return this.issuePair(row.user, familyId);
  }

  async revokeAllFor(userId: string): Promise<void> {
    await this.refreshes.update(
      { userId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }

  private async revokeFamily(familyId: string): Promise<void> {
    await this.refreshes.update(
      { familyId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }

  /**
   * Revoked rows have to outlive the token they belong to — that is what makes
   * a replay detectable. Only sweep well past expiry, when a replay could no
   * longer be honoured anyway.
   */
  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async purgeExpired(): Promise<void> {
    const { affected } = await this.refreshes.delete({
      expiresAt: LessThan(new Date(Date.now() - REFRESH_TTL_MS)),
    });
    if (affected) this.logger.log(`Purged ${affected} expired refresh tokens`);
  }

  private hash(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }
}
