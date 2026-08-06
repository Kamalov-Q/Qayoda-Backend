import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { UserRepository } from './repositories/user.repository';
import { RefreshTokenRepository } from './repositories/refresh-token.repository';
import { OtpFacade } from '../otp/otp.facade';
import { TokenService } from './token.service';
import { OutBoxService } from 'src/shared/events/outbox.service';
import { OtpPurpose } from '../otp/enums/otp-purpose.enum';
import * as bcrypt from 'bcrypt';
import { IsNull } from 'typeorm';
import { User } from './entities/user.entity';

/** One cost factor for every secret this service hashes, so a password set at
 *  registration is not cheaper to crack than one set by a reset. */
const BCRYPT_ROUNDS = 12;

@Injectable()
export class IamService {
  constructor(
    private readonly users: UserRepository,
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly otp: OtpFacade,
    private readonly tokens: TokenService,
    private readonly outbox: OutBoxService,
  ) {}

  async requestOtp(email: string, purpose: OtpPurpose) {
    const user = await this.users.findByEmail(email);
    const exists = !!user;

    const shouldSend =
      (purpose === OtpPurpose.REGISTER && !exists) ||
      (purpose === OtpPurpose.LOGIN && exists) ||
      (purpose === OtpPurpose.RESET_PASSWORD && exists) ||
      purpose === OtpPurpose.CHANGE_EMAIL;

    return this.otp.requestEmailOtp(email, purpose, shouldSend);
  }

  async verifyOtp(requestId: string, code: string) {
    const { subject: email, purpose } = await this.otp.verify(requestId, code);
    return {
      verificationToken: await this.tokens.signVerification(email, purpose),
      expiresIn: 900,
    };
  }

  async register(
    verificationToken: string,
    name: string,
    surname: string,
    password: string,
    deviceId?: string,
  ) {
    const { email } = await this.tokens.consumeVerification(
      verificationToken,
      OtpPurpose.REGISTER,
    );

    if (await this.users.findByEmail(email))
      throw new ConflictException('Account already in use!');

    const user = await this.users.save(
      this.users.create({
        email,
        name,
        surname,
        passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS),
      }),
    );

    await this.outbox.publish('user.registered', {
      userId: user.id,
      email: user.email,
    });

    return this.issueSession(user, deviceId);
  }

  async loginWithPassword(email: string, password: string, deviceId?: string) {
    const user = await this.users.findByEmail(email);

    if (
      !user?.passwordHash ||
      !(await bcrypt.compare(password, user.passwordHash))
    ) {
      throw new UnauthorizedException('Invalid credentials!');
    }

    return this.issueSession(user, deviceId);
  }

  async loginWithOtp(verificationToken: string, deviceId?: string) {
    const { email } = await this.tokens.consumeVerification(
      verificationToken,
      OtpPurpose.LOGIN,
    );

    const user = await this.users.findByEmail(email);

    if (!user) throw new UnauthorizedException('Account not found!');

    return this.issueSession(user, deviceId);
  }

  private async issueSession(user: User, deviceId?: string, familyId?: string) {
    const family = familyId ?? crypto.randomUUID();

    const row = await this.refreshTokens.save(
      this.refreshTokens.create({
        userId: user.id,
        tokenHash: '',
        deviceId: deviceId ?? null,
        familyId: family,
        expiresAt: new Date(Date.now() + 30 * 86400_000), // 30 days
      }),
    );

    const refreshToken = this.tokens.signRefresh(user.id, row.id);
    await this.refreshTokens.update(row.id, {
      tokenHash: await bcrypt.hash(refreshToken, BCRYPT_ROUNDS),
    });

    return {
      accessToken: this.tokens.signAccess(user.id, user.email, row.id),
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        surname: user.surname,
        hasPassword: !!user.passwordHash,
      },
    };
  }

  async refresh(userId: string, tokenId: string, rawToken: string) {
    const row = await this.refreshTokens.findOneBy({ id: tokenId, userId });

    if (!row)
      throw new UnauthorizedException('Session expired, please log in again!');

    if (row.revokedAt) {
      await this.refreshTokens.revokeFamily(row.familyId);

      throw new UnauthorizedException(
        'Session invalidated - please log in again!',
      );
    }

    if (
      row.expiresAt < new Date() ||
      !(await bcrypt.compare(rawToken, row.tokenHash))
    ) {
      throw new UnauthorizedException('Session expired, please log in again!');
    }

    const user = await this.users.findOneBy({ id: userId });

    if (!user) throw new UnauthorizedException('Account no longer exists!');

    // Rotate by claiming the old row first. Revoking it afterwards let two
    // concurrent refreshes both clear the checks above and walk away with a
    // live session each — and the loser's token ended up revoked regardless.
    const claimed = await this.refreshTokens.update(
      { id: row.id, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );

    if (claimed.affected !== 1) {
      await this.refreshTokens.revokeFamily(row.familyId);

      throw new UnauthorizedException(
        'Session invalidated - please log in again!',
      );
    }

    return this.issueSession(user, row.deviceId ?? undefined, row.familyId);
  }

  async logout(userId: string, tokenId: string) {
    await this.refreshTokens.update(
      { id: tokenId, userId },
      { revokedAt: new Date() },
    );
    return { success: true, message: 'Logged out' };
  }

  async logoutAll(userId: string) {
    await this.refreshTokens.revokeAllForUser(userId);
    return { success: true, message: 'Logged out on all devices' };
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ) {
    const user = await this.users.findOneBy({ id: userId });

    if (!user) throw new UnauthorizedException('User not found!');

    if (
      user.passwordHash &&
      !(await bcrypt.compare(currentPassword, user.passwordHash))
    ) {
      throw new UnauthorizedException('Current password is incorrect!');
    }

    await this.users.update(userId, {
      passwordHash: await bcrypt.hash(newPassword, BCRYPT_ROUNDS),
    });

    await this.logoutAll(userId);
    return { success: true, message: 'Password changed successfully' };
  }

  async resetPassword(verificationToken: string, newPassword: string) {
    const { email } = await this.tokens.consumeVerification(
      verificationToken,
      OtpPurpose.RESET_PASSWORD,
    );

    const user = await this.users.findByEmail(email);

    if (!user) throw new UnauthorizedException('Invalid request!');

    await this.users.update(user.id, {
      passwordHash: await bcrypt.hash(newPassword, BCRYPT_ROUNDS),
    });

    await this.logoutAll(user.id);
    return { success: true, message: 'Password reset successfully' };
  }

  async getById(userId: string) {
    const user = await this.users.findOneBy({ id: userId });

    if (!user) throw new UnauthorizedException('User not found!');

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      surname: user.surname,
      hasPassword: !!user.passwordHash,
    };
  }
}
