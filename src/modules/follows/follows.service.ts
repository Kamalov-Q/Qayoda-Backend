import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Follow } from './follow.entity';
import { User } from '../users/entities/user.entity';
import { UserStatus } from '../../shared/enums';
import { BlocksService } from '../blocks/blocks.service';
import { UserNotificationsService } from '../notifications/user-notifications.service';
import { NotificationKind } from '../notifications/notifications.constants';
import type { FollowListQueryDto } from './follows.dto';
import { likeContains, searchTerm } from '../../shared/search/like';

const DEFAULT_LIMIT = 25;

export interface FollowState {
  /** Whether the viewer follows this person. False for guests. */
  following: boolean;
  /** Whether this person follows the viewer back. False for guests. */
  followsYou: boolean;
  followerCount: number;
  followingCount: number;
}

export interface FollowPerson {
  id: string;
  name: string | null;
  surname: string | null;
  avatarThumbUrl: string | null;
  isVerifiedRealtor: boolean;
  followerCount: number;
  /** Whether the viewer follows them — drives the button on every row. */
  followedByMe: boolean;
}

/**
 * Following people, which is what turns a feed of strangers into a feed of
 * the agencies and sellers someone actually wants to hear from.
 *
 * No requests and no approval: everything in this app is public, so a follow
 * is a subscription. What it buys is the Following tab in the Videos feed and
 * a number on a profile, and nothing else — in particular it grants no
 * access, so a follow can never be a privacy decision somebody regrets.
 */
@Injectable()
export class FollowsService {
  private readonly logger = new Logger(FollowsService.name);

  constructor(
    @InjectRepository(Follow) private readonly follows: Repository<Follow>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly blocks: BlocksService,
    private readonly notifications: UserNotificationsService,
  ) {}

  /**
   * Follow or unfollow, idempotently in both directions.
   *
   * One statement, so the row and the two counters can never disagree: the
   * CTE writes the follow and the counters move by how many rows that
   * actually touched — zero for a repeat tap. Both counters are updated in
   * the same statement because they are two views of the same fact.
   */
  async setFollow(
    followerId: string,
    followeeId: string,
    next: boolean,
  ): Promise<FollowState> {
    if (followerId === followeeId) {
      throw new BadRequestException({
        code: 'CANNOT_FOLLOW_SELF',
        message: 'You cannot follow yourself',
      });
    }

    const target = await this.users.findOne({
      where: { id: followeeId },
      select: { id: true, status: true },
    });
    if (!target || target.status !== UserStatus.ACTIVE) {
      throw new NotFoundException('User not found');
    }

    // Blocked either way: the same refusal whichever direction it came from,
    // because telling someone "they blocked you" hands them information the
    // other person chose not to give.
    if (next) await this.blocks.assertNotBlocked(followerId, followeeId);

    const sql = next
      ? `WITH ins AS (
           INSERT INTO follows (follower_id, followee_id) VALUES ($1, $2)
           ON CONFLICT (follower_id, followee_id) DO NOTHING
           RETURNING 1
         ), moved AS (SELECT count(*)::int AS n FROM ins)
         UPDATE users u
            SET follower_count  = u.follower_count
                                + CASE WHEN u.id = $2 THEN (SELECT n FROM moved) ELSE 0 END,
                following_count = u.following_count
                                + CASE WHEN u.id = $1 THEN (SELECT n FROM moved) ELSE 0 END
          WHERE u.id IN ($1, $2)`
      : `WITH del AS (
           DELETE FROM follows WHERE follower_id = $1 AND followee_id = $2
           RETURNING 1
         ), moved AS (SELECT count(*)::int AS n FROM del)
         UPDATE users u
            SET follower_count  = GREATEST(u.follower_count
                                - CASE WHEN u.id = $2 THEN (SELECT n FROM moved) ELSE 0 END, 0),
                following_count = GREATEST(u.following_count
                                - CASE WHEN u.id = $1 THEN (SELECT n FROM moved) ELSE 0 END, 0)
          WHERE u.id IN ($1, $2)`;

    await this.follows.query(sql, [followerId, followeeId]);
    this.logger.log(
      `${followerId} ${next ? 'followed' : 'unfollowed'} ${followeeId}`,
    );

    // Only the follow. Being unfollowed is not news anybody needs.
    if (next) {
      await this.notifications.notify({
        userId: followeeId,
        actorId: followerId,
        kind: NotificationKind.NEW_FOLLOWER,
      });
    }

    return this.state(followerId, followeeId);
  }

  /** The button's state and the two numbers under a profile's name. */
  async state(viewerId: string | null, userId: string): Promise<FollowState> {
    const user = await this.users.findOne({
      where: { id: userId },
      select: { id: true, followerCount: true, followingCount: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const [following, followsYou] = viewerId
      ? await Promise.all([
          this.follows.existsBy({ followerId: viewerId, followeeId: userId }),
          this.follows.existsBy({ followerId: userId, followeeId: viewerId }),
        ])
      : [false, false];

    return {
      following,
      followsYou,
      followerCount: user.followerCount,
      followingCount: user.followingCount,
    };
  }

  /** Who follows this person, most recent first. */
  followers(userId: string, viewerId: string | null, q: FollowListQueryDto) {
    return this.page('followee_id', userId, viewerId, q);
  }

  /** Who this person follows, most recent first. */
  following(userId: string, viewerId: string | null, q: FollowListQueryDto) {
    return this.page('follower_id', userId, viewerId, q);
  }

  /**
   * One page of either list.
   *
   * The follow rows are read first and the people hydrated by id — not a
   * join under take/skip, which is the pattern every paged list in this
   * codebase avoids for the same reason.
   */
  private async page(
    column: 'follower_id' | 'followee_id',
    userId: string,
    viewerId: string | null,
    q: FollowListQueryDto,
  ): Promise<{ total: number; items: FollowPerson[] }> {
    const limit = q.limit ?? DEFAULT_LIMIT;
    const offset = q.offset ?? 0;
    const other = column === 'followee_id' ? 'follower_id' : 'followee_id';
    const term = searchTerm(q.q);

    /**
     * The join that narrows a list to a name.
     *
     * Searching has to reach the users table: the name being matched lives
     * there, not on the follow row. Parameterised by placeholder index
     * because the page query and the count query bind a different number of
     * values before it. Without a term it is the empty string, so opening a
     * list — the common case — still reads one index and joins nothing.
     *
     * The match is on each part AND on the two joined, so "Ali Valiyev"
     * finds a row that neither column holds on its own.
     */
    const nameJoin = (placeholder: number) =>
      term
        ? `JOIN users u ON u.id = f.${other}
            AND (u.name ILIKE $${placeholder}
              OR u.surname ILIKE $${placeholder}
              OR (coalesce(u.name, '') || ' ' || coalesce(u.surname, ''))
                 ILIKE $${placeholder})`
        : '';
    const pattern = term ? [likeContains(term)] : [];

    // Raw rather than the query builder because the column being matched is
    // the only difference between "followers" and "following", and that is a
    // column name, not a value. Both names are literals from this function's
    // own union type, so nothing user-supplied reaches the SQL; the term
    // itself is bound.
    const [rows, total] = await Promise.all([
      this.follows.query<{ id: string }[]>(
        `SELECT f.${other} AS id FROM follows f
          ${nameJoin(4)}
          WHERE f.${column} = $1
          ORDER BY f.created_at DESC
          LIMIT $2 OFFSET $3`,
        [userId, limit, offset, ...pattern],
      ),
      this.follows.query<{ n: number }[]>(
        // Counted under the same filter, so "1 of 40" never appears over a
        // search that matched one person.
        `SELECT count(*)::int AS n FROM follows f
          ${nameJoin(2)}
          WHERE f.${column} = $1`,
        [userId, ...pattern],
      ),
    ]);

    const ids = rows.map((r) => r.id);
    if (!ids.length) return { total: total[0]?.n ?? 0, items: [] };

    const [people, mine] = await Promise.all([
      this.users.find({
        where: { id: In(ids) },
        select: {
          id: true,
          name: true,
          surname: true,
          avatarThumbUrl: true,
          isVerifiedRealtor: true,
          followerCount: true,
        },
      }),
      viewerId
        ? this.follows.find({
            where: { followerId: viewerId, followeeId: In(ids) },
            select: { followeeId: true },
          })
        : Promise.resolve<Follow[]>([]),
    ]);

    const followed = new Set(mine.map((f) => f.followeeId));
    const byId = new Map(people.map((u) => [u.id, u] as const));

    return {
      total: total[0]?.n ?? 0,
      // Ordered by the follow rows, not by the hydration: "most recently
      // followed first" is the only order either of these lists has.
      items: ids
        .map((id) => byId.get(id))
        .filter((u): u is User => !!u)
        .map((u) => ({
          id: u.id,
          name: u.name,
          surname: u.surname,
          avatarThumbUrl: u.avatarThumbUrl,
          isVerifiedRealtor: u.isVerifiedRealtor,
          followerCount: u.followerCount,
          followedByMe: followed.has(u.id),
        })),
    };
  }
}
