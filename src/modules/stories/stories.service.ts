import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, LessThan, MoreThan, Repository } from 'typeorm';
import { Story, StoryReaction, StoryView } from './story.entity';
import { Listing } from '../listings/entities/listing.entity';
import { ListingStatus } from '../listings/enums/listing-status.enum';
import { User } from '../users/entities/user.entity';
import { BlocksService } from '../blocks/blocks.service';
import {
  CreateStoryDto,
  ReactToStoryDto,
  StoryViewersQueryDto,
} from './dto/story.dto';

/** The default when the poster does not choose — Telegram's default too. */
const DEFAULT_HOURS = 24;

/** How many stories one person may have up at once. Not a business rule so
 *  much as a floor under the tray: twenty stories from one shop is a tray
 *  nobody scrolls past. */
const MAX_LIVE_PER_AUTHOR = 20;

/** The poster as a story shows them: a face, a name, and whether the badge
 *  applies. Exported because the controller's return types name it. */
export interface AuthorCard {
  id: string;
  name: string | null;
  surname: string | null;
  avatarThumbUrl: string | null;
  isVerifiedRealtor: boolean;
}

@Injectable()
export class StoriesService {
  constructor(
    @InjectRepository(Story) private readonly stories: Repository<Story>,
    @InjectRepository(StoryView) private readonly views: Repository<StoryView>,
    @InjectRepository(StoryReaction)
    private readonly reactions: Repository<StoryReaction>,
    @InjectRepository(Listing) private readonly listings: Repository<Listing>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly blocks: BlocksService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * The tray: everything still up, grouped by who posted it.
   *
   * Authors with something the viewer has not seen come first, then the rest
   * by recency — the order every story tray has used since they were
   * invented, and the reason the ring around an avatar means anything.
   *
   * Public: `viewerId` is null for a guest, who simply sees nothing as seen.
   */
  async tray(viewerId: string | null) {
    const live = await this.stories.find({
      where: { expiresAt: MoreThan(new Date()) },
      order: { createdAt: 'ASC' },
    });
    if (!live.length) return { groups: [] };

    // Whoever the viewer has blocked, in either direction, is not in their
    // tray. The same rule their listings and messages already follow.
    const visible = viewerId
      ? await this.withoutBlocked(live, viewerId)
      : live;
    if (!visible.length) return { groups: [] };

    const [authors, seen] = await Promise.all([
      this.authorMap(visible.map((s) => s.authorId)),
      this.seenSet(
        viewerId,
        visible.map((s) => s.id),
      ),
    ]);

    const byAuthor = new Map<string, Story[]>();
    for (const story of visible) {
      const list = byAuthor.get(story.authorId) ?? [];
      list.push(story);
      byAuthor.set(story.authorId, list);
    }

    const groups = [...byAuthor.entries()].map(([authorId, stories]) => ({
      author: authors.get(authorId) ?? null,
      // Yours first inside the tray, whoever you are — a poster opens their
      // own tray to check on what they posted.
      isMine: authorId === viewerId,
      hasUnseen: stories.some((s) => !seen.has(s.id)),
      latestAt: stories[stories.length - 1].createdAt,
      stories: stories.map((s) => this.shape(s, seen.has(s.id))),
    }));

    groups.sort((a, b) => {
      if (a.isMine !== b.isMine) return a.isMine ? -1 : 1;
      if (a.hasUnseen !== b.hasUnseen) return a.hasUnseen ? -1 : 1;
      return b.latestAt.getTime() - a.latestAt.getTime();
    });

    return { groups };
  }

  /**
   * One person's stories, for their profile.
   *
   * Live ones for anybody. Expired ones only for the person who posted them —
   * that is what a Telegram-style archive is: a private record of what you
   * put up, not a way to read what somebody else meant to be temporary.
   */
  async byAuthor(
    authorId: string,
    viewerId: string | null,
    includeExpired: boolean,
  ) {
    const archive = includeExpired && viewerId === authorId;
    const now = new Date();

    const rows = await this.stories.find({
      where: archive
        ? { authorId }
        : { authorId, expiresAt: MoreThan(now) },
      order: { createdAt: 'DESC' },
      take: 60,
    });

    const seen = await this.seenSet(
      viewerId,
      rows.map((r) => r.id),
    );

    return {
      /** Whether the caller is looking at their own archive. */
      archive,
      items: rows.map((story) => ({
        ...this.shape(story, seen.has(story.id)),
        expired: story.expiresAt.getTime() <= now.getTime(),
      })),
    };
  }

  /** One story, with the viewer's own reaction on it. */
  async get(storyId: string, viewerId: string | null) {
    const story = await this.mustExist(storyId);
    const [author, mine, seen] = await Promise.all([
      this.authorMap([story.authorId]),
      viewerId
        ? this.reactions.findOneBy({ storyId, userId: viewerId })
        : null,
      this.seenSet(viewerId, [storyId]),
    ]);

    return {
      ...this.shape(story, seen.has(storyId)),
      author: author.get(story.authorId) ?? null,
      myReaction: mine?.emoji ?? null,
    };
  }

  async create(authorId: string, dto: CreateStoryDto) {
    if (dto.type === 'TEXT') {
      if (!dto.body?.trim()) {
        throw new BadRequestException({
          code: 'STORY_EMPTY',
          message: 'A text story needs something written on it',
        });
      }
    } else if (!dto.mediaUrl) {
      throw new BadRequestException({
        code: 'STORY_MEDIA_REQUIRED',
        message: `A ${dto.type} story needs a mediaUrl`,
      });
    }

    // A story can send people to a listing, but only to one of yours: the
    // alternative is a free channel for pointing at other people's adverts.
    if (dto.listingId) {
      const listing = await this.listings.findOne({
        where: { id: dto.listingId },
        select: { id: true, ownerId: true, status: true },
      });
      if (!listing) throw new NotFoundException({ code: 'LISTING_NOT_FOUND' });
      if (listing.ownerId !== authorId) {
        throw new ForbiddenException({
          code: 'NOT_YOUR_LISTING',
          message: 'You can only link a story to your own listing',
        });
      }
      if (listing.status !== ListingStatus.ACTIVE) {
        throw new BadRequestException({
          code: 'LISTING_NOT_ACTIVE',
          message: 'That listing is not live',
        });
      }
    }

    const live = await this.stories.count({
      where: { authorId, expiresAt: MoreThan(new Date()) },
    });
    if (live >= MAX_LIVE_PER_AUTHOR) {
      throw new BadRequestException({
        code: 'TOO_MANY_STORIES',
        message: `You already have ${live} stories up`,
      });
    }

    const hours = dto.hours ?? DEFAULT_HOURS;
    const saved = await this.stories.save(
      this.stories.create({
        authorId,
        type: dto.type,
        mediaUrl: dto.mediaUrl ?? null,
        thumbUrl: dto.thumbUrl ?? null,
        width: dto.width ?? null,
        height: dto.height ?? null,
        durationSec: dto.durationSec ?? null,
        body: dto.body?.trim() || null,
        background: dto.background ?? 0,
        listingId: dto.listingId ?? null,
        expiresAt: new Date(Date.now() + hours * 3_600_000),
      }),
    );

    return this.get(saved.id, authorId);
  }

  /** The poster, or an admin clearing something up. */
  async remove(storyId: string, userId: string, isAdmin: boolean) {
    const story = await this.mustExist(storyId);
    if (story.authorId !== userId && !isAdmin) {
      throw new ForbiddenException({ code: 'NOT_YOURS' });
    }

    await this.dataSource.transaction(async (m) => {
      await m.delete(StoryView, { storyId });
      await m.delete(StoryReaction, { storyId });
      await m.delete(Story, { id: storyId });
    });

    return { success: true };
  }

  /**
   * Records that this person watched it, and returns the count now.
   *
   * The author counts like anybody else. They were skipped at first, on the
   * grounds that their own face in their own "seen by" list tells them
   * nothing — but a story you posted and watched reading "0 views" reads as
   * broken rather than as tactful, and the count is distinct PEOPLE, so
   * opening it twenty times still adds one.
   */
  async markSeen(storyId: string, viewerId: string) {
    await this.mustExist(storyId);

    const result = await this.views
      .createQueryBuilder()
      .insert()
      .into(StoryView)
      .values({ storyId, viewerId })
      .orIgnore()
      .execute();

    // `raw`, not `identifiers`: this table's primary key is the pair of ids
    // it was handed rather than a generated column, so TypeORM fills
    // `identifiers` from the INPUT and reports every repeat view as new.
    // `raw` is what RETURNING actually gave back — empty when the row was
    // already there, which is how a second viewing stays one viewer.
    const counted = Array.isArray(result.raw) && result.raw.length > 0;
    if (!counted) {
      const current = await this.stories.findOne({
        where: { id: storyId },
        select: { id: true, viewCount: true },
      });
      return { viewCount: current?.viewCount ?? 0, counted: false };
    }

    const viewCount = await this.recount(storyId, 'view_count', 'story_views');
    return { viewCount, counted: true };
  }

  /** Set, change, or take back a reaction. The same emoji twice removes it. */
  async react(storyId: string, userId: string, dto: ReactToStoryDto) {
    await this.mustExist(storyId);
    const emoji = dto.emoji.trim();
    if (!emoji) throw new BadRequestException({ code: 'EMOJI_REQUIRED' });

    const existing = await this.reactions.findOneBy({ storyId, userId });
    if (existing?.emoji === emoji) {
      await this.reactions.delete({ storyId, userId });
    } else {
      await this.reactions.upsert(
        { storyId, userId, emoji },
        { conflictPaths: ['storyId', 'userId'] },
      );
    }

    const reactionCount = await this.recount(
      storyId,
      'reaction_count',
      'story_reactions',
    );
    return {
      reactionCount,
      myReaction: existing?.emoji === emoji ? null : emoji,
    };
  }

  /**
   * Who watched it — the poster's list, and nobody else's.
   *
   * People who reacted come first, then everyone else by when they watched.
   * That is Telegram's order and it is the right one: a poster scrolling this
   * list is looking for who said something, and burying a reaction thirty
   * names down by the accident of when they opened it wastes the one part of
   * the list that carries an opinion.
   *
   * Sorted in SQL rather than over the fetched page, or the first page would
   * be sorted and the second would not.
   */
  async viewers(storyId: string, userId: string, q: StoryViewersQueryDto) {
    const story = await this.mustExist(storyId);
    if (story.authorId !== userId) {
      throw new ForbiddenException({ code: 'NOT_YOURS' });
    }

    const limit = q.limit ?? 50;
    const offset = q.offset ?? 0;

    const rows = await this.dataSource.query<
      { viewer_id: string; created_at: Date; emoji: string | null }[]
    >(
      `SELECT v.viewer_id, v.created_at, r.emoji
         FROM story_views v
         LEFT JOIN story_reactions r
           ON r.story_id = v.story_id AND r.user_id = v.viewer_id
        WHERE v.story_id = $1
        ORDER BY (r.emoji IS NOT NULL) DESC, v.created_at DESC
        LIMIT $2 OFFSET $3`,
      [storyId, limit, offset],
    );

    const total = await this.views.countBy({ storyId });
    const people = await this.authorMap(rows.map((r) => r.viewer_id));

    return {
      total,
      items: rows.map((row) => ({
        viewer: people.get(row.viewer_id) ?? null,
        reaction: row.emoji,
        seenAt: row.created_at,
      })),
    };
  }

  /** Housekeeping for whoever wants to run it — expired rows and their
   *  children. Nothing depends on it: every read filters on `expires_at`. */
  async purgeExpired() {
    const dead = await this.stories.find({
      where: { expiresAt: LessThan(new Date()) },
      select: { id: true },
    });
    if (!dead.length) return { removed: 0 };

    const ids = dead.map((s) => s.id);
    await this.dataSource.transaction(async (m) => {
      await m.delete(StoryView, { storyId: In(ids) });
      await m.delete(StoryReaction, { storyId: In(ids) });
      await m.delete(Story, { id: In(ids) });
    });
    return { removed: ids.length };
  }

  // ------------------------------------------------------------- internals

  private async mustExist(storyId: string): Promise<Story> {
    const story = await this.stories.findOneBy({ id: storyId });
    if (!story || story.expiresAt.getTime() <= Date.now()) {
      // An expired story is gone as far as anyone reading is concerned, even
      // while its row waits to be swept.
      throw new NotFoundException({ code: 'STORY_NOT_FOUND' });
    }
    return story;
  }

  private shape(story: Story, seen: boolean) {
    return {
      id: story.id,
      authorId: story.authorId,
      type: story.type,
      mediaUrl: story.mediaUrl,
      thumbUrl: story.thumbUrl,
      width: story.width,
      height: story.height,
      durationSec: story.durationSec,
      body: story.body,
      background: story.background,
      listingId: story.listingId,
      viewCount: story.viewCount,
      reactionCount: story.reactionCount,
      expiresAt: story.expiresAt,
      createdAt: story.createdAt,
      seen,
    };
  }

  private async authorMap(ids: string[]): Promise<Map<string, AuthorCard>> {
    const unique = [...new Set(ids)];
    if (!unique.length) return new Map();

    const rows = await this.users.find({
      where: { id: In(unique) },
      select: {
        id: true,
        name: true,
        surname: true,
        avatarThumbUrl: true,
        isVerifiedRealtor: true,
      },
    });
    return new Map(rows.map((u) => [u.id, u as AuthorCard]));
  }

  private async seenSet(
    viewerId: string | null,
    storyIds: string[],
  ): Promise<Set<string>> {
    if (!viewerId || !storyIds.length) return new Set();

    const rows = await this.views.find({
      where: { viewerId, storyId: In(storyIds) },
      select: { storyId: true },
    });
    return new Set(rows.map((r) => r.storyId));
  }

  /** Drops the stories of anyone the viewer has blocked, or who blocked them. */
  private async withoutBlocked(stories: Story[], viewerId: string) {
    const authors = [...new Set(stories.map((s) => s.authorId))].filter(
      (id) => id !== viewerId,
    );
    if (!authors.length) return stories;

    const blocked = new Set(
      (
        await Promise.all(
          authors.map(async (id) =>
            (await this.blocks.betweenAny(viewerId, id)) ? id : null,
          ),
        )
      ).filter((id): id is string => !!id),
    );

    return blocked.size
      ? stories.filter((s) => !blocked.has(s.authorId))
      : stories;
  }

  /** Recomputed rather than incremented: the same reason every other count in
   *  this codebase is — an increment has nothing to correct itself against. */
  private async recount(
    storyId: string,
    column: 'view_count' | 'reaction_count',
    table: 'story_views' | 'story_reactions',
  ): Promise<number> {
    const [row] = await this.dataSource.query<{ count: number }[]>(
      `UPDATE stories
          SET ${column} = (SELECT COUNT(*) FROM ${table} WHERE story_id = $1)
        WHERE id = $1
      RETURNING ${column} AS count`,
      [storyId],
    );
    // TypeORM hands back [rows, affected] for an UPDATE, so read it back
    // rather than trusting RETURNING here (the same trap the comment count
    // fell into).
    if (typeof row?.count === 'number') return row.count;

    const story = await this.stories.findOne({
      where: { id: storyId },
      select: { id: true, viewCount: true, reactionCount: true },
    });
    return column === 'view_count'
      ? (story?.viewCount ?? 0)
      : (story?.reactionCount ?? 0);
  }
}
