import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BlocksService } from '../blocks/blocks.service';
import { TokenService } from '../auth/services/token.service';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { RatingService } from '../rating/rating.service';
import { OutBoxService } from 'src/shared/events/outbox.service';
import { ListingsFacade } from '../listings/listings.facade';
import type { OwnerListingsQuery } from '../listings/listings.service';
import { User } from './entities/user.entity';
import { UserRepository } from './repositories/user.repository';
import { UpdateProfileDto } from './dto/update-profile.dto';
import {
  ProfileResponse,
  PublicProfileResponse,
} from './responses/profile.response';
import { UserCardResponse } from './responses/user-card.response';
import type { UserSearchQueryDto } from './dto/user-search.query.dto';
import type { UserSearchResponse } from './responses/user-search.response';
import { likeContains, searchTerm } from '../../shared/search/like';
import {
  ageFrom,
  type SocialLinks,
} from './user-profile.constants';

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
    private readonly rating: RatingService,
    private readonly tokens: TokenService,
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

    // Named columns, not Partial<User>: the entity carries an `identities`
    // relation, and update() refuses a type that admits it.
    const patch: Partial<
      Pick<
        User,
        | 'name'
        | 'surname'
        | 'birthDate'
        | 'gender'
        | 'address'
        | 'bio'
        | 'socialLinks'
      >
    > = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.surname !== undefined) patch.surname = dto.surname;
    if (dto.birthDate !== undefined) patch.birthDate = dto.birthDate;
    if (dto.gender !== undefined) patch.gender = dto.gender;
    if (dto.address !== undefined) patch.address = dto.address;
    if (dto.bio !== undefined) patch.bio = dto.bio;

    // Replaced whole, not merged: the form always sends every platform it
    // knows about, and a merge would make clearing one impossible — the key
    // would simply be absent and the old value would survive. The DTO turns
    // a blank field into undefined, which drops out here.
    if (dto.socialLinks !== undefined) {
      const links = Object.fromEntries(
        Object.entries(dto.socialLinks).filter(([, v]) => !!v),
      ) as SocialLinks;
      patch.socialLinks = Object.keys(links).length > 0 ? links : null;
    }

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
  /**
   * Whether the optional half of a profile is filled in.
   *
   * Computed here rather than sent as its parts, because two of those parts
   * (gender, date of birth) are deliberately never public — see the comment
   * in getUserCard. A client given only what it is allowed to see would
   * conclude that every profile is incomplete.
   *
   * Kept in step with mobile/src/features/profile/lib/completeness.ts, which
   * applies the same rule to the OWNER's own full record.
   */
  private static isMember(user: {
    surname: string | null;
    gender: unknown;
    birthDate: unknown;
    bio: string | null;
  }): boolean {
    // No avatar in here. It is the most useful thing on a profile and the
    // form still asks for it first, but a badge a single photograph can
    // block is one most accounts never reach — and a signal almost nobody
    // carries says nothing. Asked for, not required; see the client's
    // completeness.ts, which this must stay in step with.
    return (
      !!user.surname?.trim() &&
      !!user.gender &&
      !!user.birthDate &&
      !!user.bio?.trim()
    );
  }

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
      isMember: UsersService.isMember(user),
      // Bio and socials only.
      //
      // Age, gender and address are deliberately NOT here. They were asked
      // for at registration, not written to be published, and a marketplace
      // profile that quietly prints a stranger's age and street is a
      // different product from the one anybody agreed to. The dashboard sees
      // them; the public does not.
      bio: user.bio,
      socialLinks: user.socialLinks,
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
    const [user, page, counts, rating, facets] = await Promise.all([
      this.getUserCard(userId),
      this.listings.findPublicByOwner(userId, {
        limit: UsersService.PROFILE_PAGE,
      }),
      this.listings.statsByOwner(userId),
      // Their own stars, over every review anyone left them and every report
      // upheld against them — not an average of their listings' averages,
      // which nine empty listings would dilute.
      this.rating.ownerRating(userId),
      this.listings.facetsByOwner(userId),
    ]);

    // `listings` is the first UNFILTERED page; `listingCount` is the real
    // total, so the screen can say "12 e'lon" while holding 20 of them and
    // fetch the rest through GET /users/:id/listings as the reader scrolls.
    // `facets` is what its filter sheet offers, `stats` the row above it.
    return {
      ...user,
      listings: page.items,
      listingCount: page.total,
      stats: { ...counts, ...rating },
      facets,
    };
  }

  /** A page of someone's live listings — the profile's filters applied. */
  findListingsByOwner(userId: string, q: OwnerListingsQuery) {
    return this.listings.findPublicByOwner(userId, q);
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

  // ------------------------------------------------------------------ search

  /**
   * People, by name.
   *
   * Two queries and no joins on the hot path: the page of users, then one
   * grouped count of their live listings. Counting listings per row would be
   * a query each, and the alternative — a LEFT JOIN with a GROUP BY under
   * LIMIT — makes the database sort the whole matched set before it can page
   * it. Both get slow at exactly the moment search starts being used.
   *
   * Banned and deleted accounts are excluded: a name that opens a 404 is
   * worse than no result at all.
   *
   * Blocked people are NOT excluded, but each row says whether the viewer
   * blocked them. Hiding them would make the block detectable by its own
   * absence, and would leave no way to find somebody in order to unblock
   * them; marking the row tells the viewer why the profile behind it will
   * look empty before they tap it.
   */
  async searchUsers(
    query: UserSearchQueryDto,
    viewerId: string,
  ): Promise<UserSearchResponse> {
    const term = searchTerm(query.q);
    const limit = query.limit ?? 25;
    const offset = query.offset ?? 0;

    /**
     * SELLERS, not every account.
     *
     * The inner join against live-listing counts is what makes this a
     * directory rather than a user dump: somebody who has never posted is
     * not a seller, and a list of them is not worth a screen. It also
     * produces the count each row prints, so the page costs one query
     * instead of one plus a second pass for the numbers.
     *
     * Ordered busiest-first because that is the question the screen answers
     * — "who actually trades here" — with verified agencies ahead of the
     * rest, and the id as a stable tie-break so paging cannot repeat a row.
     */
    const params: unknown[] = [limit, offset];
    let nameFilter = '';
    if (term) {
      params.push(likeContains(term));
      nameFilter = `AND (u.name ILIKE $3
                      OR u.surname ILIKE $3
                      OR (coalesce(u.name, '') || ' ' || coalesce(u.surname, ''))
                         ILIKE $3)`;
    }

    const rows = await this.users.query<
      {
        id: string;
        name: string | null;
        surname: string | null;
        avatar_thumb_url: string | null;
        is_verified_realtor: boolean;
        follower_count: number;
        listing_count: number;
        total: string;
      }[]
    >(
      `WITH sellers AS (
         SELECT owner_id, count(*)::int AS n
           FROM listings
          WHERE status = 'ACTIVE'
          GROUP BY owner_id
       )
       SELECT u.id,
              u.name,
              u.surname,
              u.avatar_thumb_url,
              u.is_verified_realtor,
              u.follower_count,
              s.n AS listing_count,
              count(*) OVER () AS total
         FROM users u
         JOIN sellers s ON s.owner_id = u.id
        WHERE u.deleted_at IS NULL
          AND u.status = 'ACTIVE'
          ${nameFilter}
        ORDER BY u.is_verified_realtor DESC, s.n DESC, u.id ASC
        LIMIT $1 OFFSET $2`,
      params,
    );

    if (!rows.length) return { total: 0, items: [] };

    // Blocked people stay in the list, marked. Hiding them would make a
    // block detectable by its own absence and leave no way to find somebody
    // in order to unblock them.
    const blocked = await this.blocks.blockedSet(
      viewerId,
      rows.map((r) => r.id),
    );

    return {
      // count(*) OVER () is the total before LIMIT — the same number for
      // every row, so reading it off the first is correct and free.
      total: Number(rows[0].total),
      items: rows.map((r) => ({
        id: r.id,
        name: r.name,
        surname: r.surname,
        avatarThumbUrl: r.avatar_thumb_url,
        isVerifiedRealtor: r.is_verified_realtor,
        followerCount: r.follower_count,
        listingCount: r.listing_count,
        blockedByMe: blocked.has(r.id),
      })),
    };
  }

  // ----------------------------------------------------------- deletion

  /**
   * A user deleting their own account.
   *
   * Archive is this app's delete, and that holds here too: no row is dropped.
   * What leaves is the person — every column that could name them is nulled,
   * their listings and videos come down, and every way back in is revoked.
   * What stays is the shape of what happened: a conversation the other side
   * still needs to read, a review a listing's rating was computed from, a
   * wallet row the accountant is required to keep.
   *
   * Listings go through the facade one at a time rather than in a single
   * UPDATE, because `listing.archived` is what takes the pin off the map and
   * clears the feed caches. A bulk write would leave the map advertising
   * property belonging to an account that no longer exists.
   *
   * Outside the transaction on purpose: each archive opens its own, and
   * nesting them under one outer transaction would hold a write lock across
   * every listing the user ever posted.
   */
  async deleteOwnAccount(userId: string, reason?: string): Promise<void> {
    await this.findOrFail(userId);

    for (const listingId of await this.listings.liveIdsByOwner(userId)) {
      await this.listings.archiveById(listingId);
    }

    await this.dataSource.transaction(async (manager) => {
      await manager.query(
        `UPDATE videos
            SET status = 'REMOVED', updated_at = now()
          WHERE author_id = $1 AND status <> 'REMOVED'`,
        [userId],
      );

      // The device rows, not merely the tokens: a push delivered after this
      // point would land on the phone of somebody who asked to be forgotten.
      await manager.query('DELETE FROM push_tokens WHERE user_id = $1', [
        userId,
      ]);

      // Passport scans and the selfie. The rows go here; the files behind
      // the URLs are Bunny's and are swept by the media cleanup.
      await manager.query(
        'DELETE FROM verification_requests WHERE user_id = $1',
        [userId],
      );

      // Saved listings and blocks are personal lists and nobody else reads
      // them, so they leave with the account.
      await manager.query('DELETE FROM listing_saves WHERE user_id = $1', [
        userId,
      ]);
      await manager.query(
        'DELETE FROM user_blocks WHERE blocker_id = $1 OR blocked_id = $1',
        [userId],
      );

      // Follows carry denormalised counters on the OTHER user, maintained by
      // FollowsService. Deleting the rows without these two updates leaves
      // every profile this account touched advertising a follower it no
      // longer has — and the count is drawn on the most visited screen in
      // the app. GREATEST guards a counter that has already drifted below
      // the row count; without it a drifted row would go negative.
      await manager.query(
        `UPDATE users u
            SET follower_count = GREATEST(u.follower_count - 1, 0)
           FROM follows f
          WHERE f.follower_id = $1 AND u.id = f.followee_id`,
        [userId],
      );
      await manager.query(
        `UPDATE users u
            SET following_count = GREATEST(u.following_count - 1, 0)
           FROM follows f
          WHERE f.followee_id = $1 AND u.id = f.follower_id`,
        [userId],
      );
      await manager.query(
        'DELETE FROM follows WHERE follower_id = $1 OR followee_id = $1',
        [userId],
      );

      // Without this the next SMS sign-in from that number would match the
      // identity row and hand the caller this dead account back.
      await manager.query('DELETE FROM auth_identities WHERE user_id = $1', [
        userId,
      ]);

      // Named columns, for the reason updateProfile gives.
      const scrub: Partial<
        Pick<
          User,
          | 'name'
          | 'surname'
          | 'avatarUrl'
          | 'avatarThumbUrl'
          | 'phoneNumber'
          | 'email'
          | 'passwordHash'
          | 'birthDate'
          | 'gender'
          | 'address'
          | 'bio'
          | 'socialLinks'
          | 'isOnline'
          | 'followerCount'
          | 'followingCount'
          | 'deletedAt'
          | 'deletedBy'
          | 'deleteReason'
        >
      > = {
        name: null,
        surname: null,
        avatarUrl: null,
        avatarThumbUrl: null,
        // Nulled rather than kept so the same person can sign up again: the
        // unique index permits any number of NULLs, and leaving the number
        // here would match them back onto this row forever.
        phoneNumber: null,
        email: null,
        passwordHash: null,
        birthDate: null,
        gender: null,
        address: null,
        bio: null,
        socialLinks: null,
        isOnline: false,
        followerCount: 0,
        followingCount: 0,
        deletedAt: new Date(),
        deletedBy: userId,
        deleteReason: reason ?? null,
      };
      await manager.update(User, userId, scrub);
    });

    // After the commit: a token revoked before it fails would log them out of
    // an account that is still intact.
    await this.tokens.revokeAllFor(userId);
    JwtAccessGuard.invalidate(userId);
  }

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
      // Their own profile, so everything they told us comes back — including
      // the birth date itself, because the edit form has to show what it is
      // about to overwrite.
      birthDate: user.birthDate,
      age: ageFrom(user.birthDate),
      gender: user.gender,
      address: user.address,
      bio: user.bio,
      socialLinks: user.socialLinks,
      createdAt: user.createdAt,
    };
  }
}
