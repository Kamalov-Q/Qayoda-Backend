import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BlocksService } from '../blocks/blocks.service';
import { OutBoxService } from 'src/shared/events/outbox.service';
import { ListingsFacade } from '../listings/listings.facade';
import { User } from './entities/user.entity';
import { UserRepository } from './repositories/user.repository';
import { UpdateProfileDto } from './dto/update-profile.dto';
import {
  ProfileResponse,
  PublicProfileResponse,
} from './responses/profile.response';
import { UserCardResponse } from './responses/user-card.response';

/**
 * Who a user *is*: profile, avatar, presence. Proving who they are is
 * AuthModule's job — nothing here touches credentials, tokens or sessions.
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly users: UserRepository,
    private readonly listings: ListingsFacade,
    private readonly outbox: OutBoxService,
    private readonly dataSource: DataSource,
    private readonly blocks: BlocksService,
  ) {}

  // ------------------------------------------------------------- own profile

  async getProfile(userId: string): Promise<ProfileResponse> {
    return this.toProfile(await this.findOrFail(userId));
  }

  /**
   * Name and surname only. Phone and email are set by the provider that
   * verified them and are not editable here — a user who could type in someone
   * else's number would be handed their account the next time that person
   * signed in by SMS, because a verified contact detail is what auto-linking
   * matches on.
   */
  async updateProfile(
    userId: string,
    dto: UpdateProfileDto,
  ): Promise<ProfileResponse> {
    await this.findOrFail(userId);

    const patch: Partial<Pick<User, 'name' | 'surname'>> = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.surname !== undefined) patch.surname = dto.surname;

    if (Object.keys(patch).length > 0) {
      await this.users.update(userId, patch);
    }

    return this.getProfile(userId);
  }

  setAvatar(
    userId: string,
    avatar: { url: string; thumbUrl: string },
  ): Promise<ProfileResponse> {
    return this.replaceAvatar(userId, avatar.url, avatar.thumbUrl);
  }

  removeAvatar(userId: string): Promise<ProfileResponse> {
    return this.replaceAvatar(userId, null, null);
  }

  /** Swaps the avatar and hands whatever it displaced to the media cleanup. */
  private async replaceAvatar(
    userId: string,
    url: string | null,
    thumbUrl: string | null,
  ): Promise<ProfileResponse> {
    const user = await this.findOrFail(userId);

    const orphaned = [user.avatarUrl, user.avatarThumbUrl].filter(
      (u): u is string => !!u,
    );

    await this.dataSource.transaction(async (manager) => {
      await manager.update(User, userId, {
        avatarUrl: url,
        avatarThumbUrl: thumbUrl,
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

  // ------------------------------------------------------------ other people

  /** The profile card behind an avatar tap. */
  async getUserCard(userId: string): Promise<UserCardResponse> {
    const user = await this.findOrFail(userId);

    return {
      id: user.id,
      fullName: this.fullName(user),
      name: user.name,
      surname: user.surname,
      phoneNumber: user.phoneNumber,
      avatarUrl: user.avatarUrl,
      avatarThumbUrl: user.avatarThumbUrl,
      isVerifiedRealtor: user.isVerifiedRealtor,
      createdAt: user.createdAt,
    };
  }

  /** Everything the profile screen shows in one call: who they are, and their ads. */
  /** How many of someone's ads the profile screen opens with. */
  private static readonly PROFILE_PAGE = 20;

  /**
   * The public profile, as the viewer is allowed to see it.
   *
   * A block hides presence and the phone number in BOTH directions: from the
   * person who was blocked, because that is what blocking is for, and from
   * the person who blocked them, because they asked not to be shown this
   * account. The name and listings stay — the adverts are public whatever
   * the two of them think of each other.
   */
  async getProfileWithListingsFor(userId: string, viewerId: string | null) {
    const profile = await this.getProfileWithListings(userId);

    const [blockedByMe, blockedEitherWay] = viewerId
      ? await Promise.all([
          this.blocks.hasBlocked(viewerId, userId),
          this.blocks.betweenAny(viewerId, userId),
        ])
      : [false, false];

    if (!blockedEitherWay) return { ...profile, blockedByMe };

    return {
      ...profile,
      phoneNumber: null,
      isOnline: false,
      lastSeenAt: null,
      blockedByMe,
    };
  }

  async getProfileWithListings(userId: string) {
    // The card 404s on an unknown id, so the listings queries are only ever
    // used for a user that exists — but all are in flight before that is
    // known, which costs nothing on the miss and saves round trips on the hit.
    const [user, listings, listingCount] = await Promise.all([
      this.getUserCard(userId),
      this.listings.findPublicByOwner(userId, UsersService.PROFILE_PAGE),
      this.listings.countPublicByOwner(userId),
    ]);

    // `listings` is the first page only; `listingCount` is the real total, so
    // the screen can say "12 e'lon" while holding 20 of them, and fetch the
    // rest through GET /users/:id/listings as the reader scrolls.
    return { ...user, listings, listingCount };
  }

  /** A page of someone's live listings, for scrolling past the first. */
  findListingsByOwner(userId: string, limit?: number, offset?: number) {
    return this.listings.findPublicByOwner(userId, limit, offset);
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

  // ---------------------------------------------------------------- presence

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

  // ----------------------------------------------------------------- helpers

  private async findOrFail(userId: string): Promise<User> {
    const user = await this.users.findOneBy({ id: userId });
    if (!user) throw new NotFoundException('User not found!');
    return user;
  }

  private fullName(user: User): string | null {
    return (
      [user.name, user.surname].filter((part) => !!part?.trim()).join(' ') ||
      null
    );
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
      language: user.language,
      isVerifiedRealtor: user.isVerifiedRealtor,
      createdAt: user.createdAt,
    };
  }
}
