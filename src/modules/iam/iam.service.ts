import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { UserRepository } from './repositories/user.repository';
import { RefreshTokenRepository } from './repositories/refresh-token.repository';
import { OtpFacade } from '../otp/otp.facade';
import { TokenService } from './token.service';
import { OutBoxService } from 'src/shared/events/outbox.service';
import { OtpPurpose } from '../otp/enums/otp-purpose.enum';
import * as bcrypt from 'bcrypt';
import { DataSource, IsNull } from 'typeorm';
import { User } from './entities/user.entity';
import {
  ProfileResponse,
  PublicProfileResponse,
} from './responses/profile.response';
import { UserCardResponse } from './responses/user-card.response';
import { UpdateProfileDto } from './dto/update-profile.dto';

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
    private readonly dataSource: DataSource,
  ) {}

  async requestOtp(email: string, purpose: OtpPurpose) {
    const user = await this.users.findByEmail(email);
    const exists = !!user;

    // LOGIN and REGISTER fail loudly on the wrong account state. The silent
    // no-send this used to do read as anti-enumeration, but the login screen
    // itself confirms which of the two flows applies to an address the moment
    // you pick one — so the silence protected nothing and cost real users an
    // OTP screen waiting for a code that was never sent.
    if (purpose === OtpPurpose.LOGIN && !exists)
      throw new NotFoundException('No account with this email');
    if (purpose === OtpPurpose.REGISTER && exists)
      throw new ConflictException('Account already in use!');

    // RESET_PASSWORD stays silent: a "forgot password" form is the classic
    // address-probing target, and its user already believes they have an
    // account — "check your inbox" is the honest answer either way.
    const shouldSend =
      purpose === OtpPurpose.LOGIN ||
      purpose === OtpPurpose.REGISTER ||
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

  async setPresence(userId: string, online: boolean): Promise<void> {
    await this.users.update(userId, {
      isOnline: online,
      lastSeenAt: new Date(),
    });
  }

  async getPresence(
    userIds: string[],
  ): Promise<{ userId: string; online: boolean; lastSeenAt: Date | null }[]> {
    if (userIds.length === 0) return [];

    const rows = await this.users.find({
      where: userIds.map((id) => ({ id })),
      select: { id: true, isOnline: true, lastSeenAt: true },
    });

    return rows.map((u) => ({
      userId: u.id,
      online: u.isOnline,
      lastSeenAt: u.lastSeenAt,
    }));
  }

  /** Sockets do not survive a restart — anyone still flagged online is stale. */
  async resetAllPresence(): Promise<void> {
    await this.users
      .createQueryBuilder()
      .update()
      .set({
        isOnline: false,
        lastSeenAt: () => 'COALESCE(last_seen_at, now())',
      })
      .where('is_online = true')
      .execute();
  }

  async getProfile(userId: string): Promise<ProfileResponse> {
    const user = await this.users.findOneBy({ id: userId });
    if (!user) throw new UnauthorizedException('User not found!');
    return this.toProfile(user);
  }

  async updateProfile(
    userId: string,
    dto: UpdateProfileDto,
  ): Promise<ProfileResponse> {
    const user = await this.users.findOneBy({ id: userId });
    if (!user) throw new NotFoundException('User not found!');

    const patch: Partial<User> = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.surname !== undefined) patch.surname = dto.surname;
    if (dto.phoneNumber !== undefined) patch.phoneNumber = dto.phoneNumber;

    if (Object.keys(patch).length > 0) {
      await this.users.update(userId, patch);
    }

    return this.getProfile(userId);
  }

  async setAvatar(
    userId: string,
    avatar: { url: string; thumbUrl: string },
  ): Promise<ProfileResponse> {
    const user = await this.users.findOneBy({ id: userId });
    if (!user) throw new NotFoundException('User not found!');

    const orphaned = [user.avatarUrl, user.avatarThumbUrl].filter(
      (u): u is string => !!u,
    );

    await this.dataSource.transaction(async (manager) => {
      await manager.update(User, userId, {
        avatarUrl: avatar.url,
        avatarThumbUrl: avatar.thumbUrl,
      });

      if (orphaned.length) {
        await this.outbox.publish(
          'media.files_orphaned',
          { urls: orphaned },
          manager,
        );
      }
    });

    return this.getProfile(userId);
  }

  async removeAvatar(userId: string): Promise<ProfileResponse> {
    const user = await this.users.findOneBy({ id: userId });
    if (!user) throw new NotFoundException('User not found!');

    const orphaned = [user.avatarUrl, user.avatarThumbUrl].filter(
      (u): u is string => !!u,
    );

    await this.dataSource.transaction(async (manager) => {
      await manager.update(User, userId, {
        avatarUrl: null,
        avatarThumbUrl: null,
      });
      if (orphaned.length) {
        await this.outbox.publish(
          'media.files_orphaned',
          { urls: orphaned },
          manager,
        );
      }
    });

    return this.getProfile(userId);
  }

  async getPublicProfiles(userIds: string[]): Promise<PublicProfileResponse[]> {
    if (userIds.length === 0) return [];

    const rows = await this.users.find({
      where: userIds.map((id) => ({ id })),
      select: {
        id: true,
        name: true,
        surname: true,
        avatarUrl: true,
        avatarThumbUrl: true,
        phoneNumber: true,
      },
    });

    return rows.map((u) => ({
      id: u.id,
      name: u.name,
      surname: u.surname,
      avatarUrl: u.avatarUrl,
      avatarThumbUrl: u.avatarThumbUrl,
      phoneNumber: u.phoneNumber,
    }));
  }

  /** The profile card behind an avatar tap — contact details included. */
  async getUserCard(userId: string): Promise<UserCardResponse> {
    const user = await this.users.findOneBy({ id: userId });
    if (!user) throw new NotFoundException('User not found!');

    const fullName = [user.name, user.surname]
      .filter((part) => !!part?.trim())
      .join(' ');

    return {
      id: user.id,
      fullName: fullName || null,
      name: user.name,
      surname: user.surname,
      email: user.email,
      phoneNumber: user.phoneNumber,
      avatarUrl: user.avatarUrl,
      avatarThumbUrl: user.avatarThumbUrl,
      createdAt: user.createdAt,
    };
  }

  private toProfile(user: User): ProfileResponse {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      surname: user.surname,
      avatarUrl: user.avatarUrl,
      avatarThumbUrl: user.avatarThumbUrl,
      phoneNumber: user.phoneNumber,
      createdAt: user.createdAt,
    };
  }
}
