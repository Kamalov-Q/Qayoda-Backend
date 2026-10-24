import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { Video } from './entities/video.entity';
import { VideoLike } from './entities/video-like.entity';
import {
  BUNNY_VIDEO_STATUS,
  LISTING_LINK_BOOST_HOURS,
  VIDEO_DAILY_LIMIT,
  VIDEO_DURATION_SLACK_SEC,
  FOLLOWER_FANOUT_CAP,
  VIDEO_FEED_MAX,
  VIDEO_MAX_DURATION_SEC,
  VideoFailReason,
  VideoStatus,
} from './videos.constants';
import { likeContains, searchTerm } from '../../shared/search/like';
import { BunnyStreamService, type BunnyVideo } from './bunny-stream.service';
import { Listing } from '../listings/entities/listing.entity';
import { ListingStatus } from '../listings/enums/listing-status.enum';
import { User } from '../users/entities/user.entity';
import { Tariff } from '../billing/entities/tariff.entity';
import { WalletService } from '../billing/wallet.service';
import { UserNotificationsService } from '../notifications/user-notifications.service';
import { NotificationKind } from '../notifications/notifications.constants';
import { UserRole } from '../../shared/enums';
import {
  CreateUploadTicketDto,
  MyVideosQueryDto,
  UpdateVideoDto,
  VideoFeedQueryDto,
} from './dto/video.dto';
import { AdminVideosQueryDto } from './dto/admin-videos.dto';

/** The author, as the overlay on a reel needs them. */
export interface VideoAuthor {
  id: string;
  name: string | null;
  surname: string | null;
  avatarThumbUrl: string | null;
  isVerifiedRealtor: boolean;
}

/** The listing a reel advertises, as its call-to-action needs it. */
export interface VideoListingCard {
  id: string;
  title: string | null;
  thumbUrl: string | null;
  price: string | null;
  currency: string | null;
  purpose: string | null;
}

export interface VideoResponse {
  id: string;
  authorId: string;
  listingId: string | null;
  status: VideoStatus;
  failReason: string | null;
  caption: string | null;
  durationSec: number | null;
  width: number | null;
  height: number | null;
  /** Null until the file is playable. */
  hlsUrl: string | null;
  thumbUrl: string | null;
  /** Bunny's iframe player. For the dashboard; the app plays the HLS itself. */
  embedUrl: string | null;
  likeCount: number;
  commentCount: number;
  viewCount: number;
  /** Always false for guests — a heart nobody can attribute is not filled. */
  likedByMe: boolean;
  publishedAt: string | null;
  createdAt: string;
  author: VideoAuthor | null;
  listing: VideoListingCard | null;
}

export interface VideoFeedPage {
  items: VideoResponse[];
  /** Hand this back as `cursor`. Null means the end. */
  nextCursor: string | null;
}

/**
 * Which pool a feed page is drawn from.
 *
 * `u` — videos this viewer has not watched yet, which is what they came for.
 * `s` — the ones they have, in the same order, so the feed never dead-ends.
 * `a` — everything, for a caller we cannot identify at all (no session and
 *       no device header), where "seen" is unanswerable.
 */
type FeedPhase = 'u' | 's' | 'a';

interface FeedCursor {
  phase: FeedPhase;
  rankAt: string;
  id: string;
}

@Injectable()
export class VideosService {
  private readonly logger = new Logger(VideosService.name);

  constructor(
    @InjectRepository(Video) private readonly videos: Repository<Video>,
    @InjectRepository(VideoLike) private readonly likes: Repository<VideoLike>,
    @InjectRepository(Listing) private readonly listings: Repository<Listing>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Tariff) private readonly tariffs: Repository<Tariff>,
    private readonly ds: DataSource,
    private readonly bunny: BunnyStreamService,
    private readonly wallet: WalletService,
    private readonly notifications: UserNotificationsService,
  ) {}

  // ---- Posting ----------------------------------------------------------

  /**
   * Reserve a video at Bunny and hand the phone a signed, short-lived ticket
   * to upload straight into it.
   *
   * Three things are checked BEFORE the upload rather than after, because
   * each of them would otherwise waste somebody's mobile data: the daily
   * posting limit, that the listing being advertised is really theirs, and
   * that the wallet can cover VIDEO_POST. The last one is a courtesy, not the
   * charge — the money moves when Bunny confirms a valid file (see
   * `finalize`), so an upload that dies halfway costs nothing.
   */
  async createUploadTicket(userId: string, dto: CreateUploadTicketDto) {
    if (!this.bunny.configured) {
      throw new ServiceUnavailableException({
        code: 'VIDEO_UNAVAILABLE',
        message: 'Video uploads are not configured',
      });
    }

    const listing = dto.listingId
      ? await this.mustOwnListing(dto.listingId, userId)
      : null;

    await this.assertUnderDailyLimit(userId);
    const price = await this.priceCheck(userId);

    const title = (
      dto.caption?.slice(0, 80) ||
      listing?.title ||
      'Growen City video'
    ).trim();

    const created = await this.bunny.createVideo(title);

    const video = await this.videos.save(
      this.videos.create({
        authorId: userId,
        listingId: listing?.id ?? null,
        providerId: created.guid,
        status: VideoStatus.UPLOADING,
        caption: dto.caption ?? null,
      }),
    );

    this.logger.log(
      `Upload ticket ${video.id} (bunny ${created.guid}) for ${userId}` +
        `${listing ? ` listing=${listing.id}` : ''}`,
    );

    return {
      videoId: video.id,
      /** What it will cost on publish. Null when nothing is charged. */
      price,
      upload: {
        ...this.bunny.signUpload(created.guid),
        /** tus metadata, which Bunny requires both of. */
        metadata: { filetype: dto.mimeType ?? 'video/mp4', title },
      },
    };
  }

  /**
   * Bunny has something to say about a video: find out what is true and move
   * the row accordingly.
   *
   * Driven by the webhook, and by the resync sweep for the webhooks that
   * never arrive. Deliberately re-reads the video from Bunny's API instead of
   * trusting the callback body: the body is three fields over plain HTTP from
   * a third party, and this decision both spends the user's money and lets a
   * file become public.
   *
   * Idempotent: a video that is already READY, FAILED or REMOVED is left
   * exactly as it is, because Bunny fires status 3 and 4 for the same file
   * and both land here.
   */
  async finalize(providerId: string): Promise<void> {
    const video = await this.videos.findOneBy({ providerId });
    if (!video) return;
    if (
      video.status !== VideoStatus.UPLOADING &&
      video.status !== VideoStatus.AWAITING_PAYMENT
    ) {
      return;
    }

    let remote: BunnyVideo;
    try {
      remote = await this.bunny.getVideo(providerId);
    } catch {
      // Bunny is having a moment. The resync sweep will come back to it.
      return;
    }

    if (
      remote.status === BUNNY_VIDEO_STATUS.ERROR ||
      remote.status === BUNNY_VIDEO_STATUS.UPLOAD_FAILED
    ) {
      await this.fail(video, VideoFailReason.ENCODING_FAILED);
      return;
    }

    // Length arrives when Bunny has probed the file, which is before the last
    // resolution finishes. No length yet means there is nothing to decide.
    if (!remote.length || remote.length <= 0) return;

    if (remote.length > VIDEO_MAX_DURATION_SEC + VIDEO_DURATION_SLACK_SEC) {
      this.logger.warn(
        `Video ${video.id} rejected: ${remote.length}s exceeds ${VIDEO_MAX_DURATION_SEC}s`,
      );
      await this.fail(video, VideoFailReason.TOO_LONG);
      return;
    }

    // Playable is enough to publish: Bunny reports one resolution finished
    // (status 4 / availableResolutions) well before the whole ladder is done,
    // and the HLS manifest already serves what exists.
    const playable =
      remote.status === BUNNY_VIDEO_STATUS.FINISHED ||
      !!remote.availableResolutions;
    if (!playable) return;

    await this.publish(video, remote);
  }

  /**
   * Charge VIDEO_POST and make the video public, in one transaction.
   *
   * An empty wallet is not a failure here: the file is encoded, within the
   * limit and costs us storage either way, so it parks in AWAITING_PAYMENT
   * for 48 hours and the author can top up and tap publish. Any other error
   * leaves the row untouched for the sweep to retry.
   */
  private async publish(video: Video, remote: BunnyVideo): Promise<void> {
    const media = {
      durationSec: remote.length,
      width: remote.width || null,
      height: remote.height || null,
      thumbnailFile: remote.thumbnailFileName || null,
    };

    try {
      await this.ds.transaction(async (manager) => {
        await this.wallet.charge(
          manager,
          video.authorId,
          'VIDEO_POST',
          video.id,
        );

        const publishedAt = new Date();
        await manager.update(Video, video.id, {
          ...media,
          status: VideoStatus.READY,
          failReason: null,
          publishedAt,
          rankAt: this.rankFor(publishedAt, video.listingId),
        });
      });
      this.logger.log(`Video ${video.id} published (${remote.length}s)`);
      // The author is not watching this happen — encoding takes a minute and
      // the phone has moved on. This is the only way they learn.
      await this.notifications.notify({
        userId: video.authorId,
        kind: NotificationKind.VIDEO_READY,
        videoId: video.id,
      });
      await this.notifyFollowersOfPost(video.authorId, video.id);
    } catch (error) {
      if (!this.isInsufficientFunds(error)) throw error;

      await this.videos.update(video.id, {
        ...media,
        status: VideoStatus.AWAITING_PAYMENT,
      });
      this.logger.warn(
        `Video ${video.id} awaiting payment: ${video.authorId} cannot cover VIDEO_POST`,
      );
      await this.notifications.notify({
        userId: video.authorId,
        kind: NotificationKind.VIDEO_AWAITING_PAYMENT,
        videoId: video.id,
      });
    }
  }

  /**
   * "Publish" on a video that was waiting for money.
   *
   * The only path that lets a 402 reach the app, which is the point: the
   * author is standing in front of the screen, so the refusal can say what
   * it costs and offer the top-up.
   */
  async publishPending(videoId: string, userId: string) {
    const video = await this.mustOwn(videoId, userId);
    if (video.status === VideoStatus.READY) return this.detail(videoId, userId);
    if (video.status !== VideoStatus.AWAITING_PAYMENT) {
      throw new BadRequestException({
        code: 'VIDEO_NOT_PAYABLE',
        message: 'This video is not waiting for payment',
      });
    }

    await this.ds.transaction(async (manager) => {
      await this.wallet.charge(manager, userId, 'VIDEO_POST', video.id);
      const publishedAt = new Date();
      await manager.update(Video, video.id, {
        status: VideoStatus.READY,
        publishedAt,
        rankAt: this.rankFor(publishedAt, video.listingId),
      });
    });

    return this.detail(videoId, userId);
  }

  // ---- Reading ----------------------------------------------------------

  /**
   * One page of the Videos tab.
   *
   * Keyset pagination on (rank_at, id), never offset: people post into this
   * feed all day, and under an offset every new upload shifts the window by
   * one — which is exactly how the same reel turns up twice while another is
   * never seen at all.
   *
   * Unwatched clips come first, then the watched ones, so a feed that has
   * been through once keeps working instead of showing the same twenty videos
   * forever. Both pools are the same query with one predicate flipped.
   */
  async feed(
    viewerId: string | null,
    viewerKey: string | null,
    q: VideoFeedQueryDto,
  ): Promise<VideoFeedPage> {
    const limit = Math.min(q.limit ?? VIDEO_FEED_MAX, VIDEO_FEED_MAX);
    const cursor = this.decodeCursor(q.cursor);
    const term = searchTerm(q.q);
    /**
     * A search is not a feed.
     *
     * The two phases exist to show somebody what they have not watched
     * before what they have, which is the right answer to "show me
     * something". It is the wrong answer to "find me videos about X": the
     * match either exists or it does not, and hiding half the matches
     * because they are already watched makes a search look broken. So a
     * search runs the 'a' (all) phase and nothing else.
     */
    const phase: FeedPhase = term
      ? 'a'
      : (cursor?.phase ?? (viewerKey ? 'u' : 'a'));

    // The Following feed is meaningless without a session: there is nobody
    // to follow yet, and an empty page says that better than everybody's
    // videos would.
    if (q.scope === 'following' && !viewerId) {
      return { items: [], nextCursor: null };
    }

    const rows = await this.feedPage(
      phase,
      cursor,
      limit,
      viewerId,
      viewerKey,
      q.scope,
      term,
    );

    // The unwatched pool ran dry: top the page up from the watched one rather
    // than handing back a half-empty screen with nothing after it. Never on a
    // search — there is no second pool to top up from.
    if (phase === 'u' && rows.length < limit) {
      const seen = await this.feedPage(
        's',
        null,
        limit - rows.length,
        viewerId,
        viewerKey,
        q.scope,
      );
      const items = [...rows, ...seen];
      return {
        items: await this.shapeMany(items, viewerId),
        nextCursor: seen.length ? this.encodeCursor('s', seen.at(-1)!) : null,
      };
    }

    return {
      items: await this.shapeMany(rows, viewerId),
      nextCursor:
        rows.length === limit ? this.encodeCursor(phase, rows.at(-1)!) : null,
    };
  }

  /**
   * Tell this author's followers that a new reel is up.
   *
   * Fan-out on WRITE, unlike the Following feed, which resolves the same
   * relationship per query on read. The two are different shapes of problem:
   * the feed asks "what is there" once per scroll and can filter; an inbox
   * has to have a row per person, so somebody has to write them.
   *
   * Capped, and deliberately. A seller with ten thousand followers posting
   * five clips a day is fifty thousand rows that nobody reads, and the cap
   * is the difference between a notification and a broadcast. Past it the
   * Following feed is still the complete answer \u2014 which is where this kind
   * of thing belongs anyway.
   */
  private async notifyFollowersOfPost(
    authorId: string,
    videoId: string,
  ): Promise<void> {
    try {
      const rows = await this.videos.query<{ follower_id: string }[]>(
        `SELECT follower_id FROM follows
          WHERE followee_id = $1
          ORDER BY created_at DESC
          LIMIT $2`,
        [authorId, FOLLOWER_FANOUT_CAP],
      );

      await this.notifications.notifyMany(
        rows.map((r) => r.follower_id),
        {
          actorId: authorId,
          kind: NotificationKind.FOLLOWED_USER_POSTED,
          videoId,
        },
      );
    } catch (error) {
      // Same contract as notify() itself: a publish must not fail because
      // the people who follow the author could not be told about it.
      this.logger.warn(
        `Follower fan-out for video ${videoId} failed: ${
          (error as Error).message
        }`,
      );
    }
  }

  private feedPage(
    phase: FeedPhase,
    cursor: FeedCursor | null,
    limit: number,
    viewerId: string | null,
    viewerKey: string | null,
    scope?: 'foryou' | 'following',
    /** Already trimmed and length-checked by the caller. */
    term?: string,
  ): Promise<Video[]> {
    const qb = this.videos
      .createQueryBuilder('v')
      // Nothing from a banned or deleted account is in the feed. An inner
      // join rather than a NOT EXISTS because the row has to exist anyway.
      .innerJoin(
        User,
        'u',
        "u.id = v.author_id AND u.deleted_at IS NULL AND u.status = 'ACTIVE'",
      )
      .where('v.status = :ready', { ready: VideoStatus.READY })
      .orderBy('v.rank_at', 'DESC')
      .addOrderBy('v.id', 'DESC')
      .limit(limit);

    if (cursor) {
      // Row comparison, so the tie-break on id is part of the same index scan.
      qb.andWhere(
        '(v.rank_at, v.id) < (:cursorRank::timestamptz, :cursorId::uuid)',
        { cursorRank: cursor.rankAt, cursorId: cursor.id },
      );
    }

    if (viewerId) {
      // A block hides both directions: the person who drew the line should
      // not have to watch them, and should not be watched by them either.
      qb.andWhere(
        `NOT EXISTS (
           SELECT 1 FROM user_blocks b
            WHERE (b.blocker_id = :me AND b.blocked_id = v.author_id)
               OR (b.blocked_id = :me AND b.blocker_id = v.author_id))`,
        { me: viewerId },
      );
    }

    // Fan-out on read: the people someone follows, resolved per query
    // against the (follower_id, created_at) index. Fine to a few thousand
    // follows per person, which is well past anything this market will see —
    // the alternative (a materialised timeline per user) is only worth
    // building for accounts with millions of followers.
    if (scope === 'following' && viewerId) {
      qb.andWhere(
        `EXISTS (
           SELECT 1 FROM follows f
            WHERE f.follower_id = :me AND f.followee_id = v.author_id)`,
        { me: viewerId },
      );
    }

    // Caption only. A description search that also matched the author's
    // name would quietly make this a people search too, and the one on the
    // People tab is the one that can rank and paginate people properly.
    if (term) {
      qb.andWhere('v.caption ILIKE :term', { term: likeContains(term) });
    }

    if (phase !== 'a' && viewerKey) {
      const seen = `EXISTS (SELECT 1 FROM video_views vv
                             WHERE vv.video_id = v.id
                               AND vv.viewer_key = :viewerKey)`;
      qb.andWhere(phase === 'u' ? `NOT ${seen}` : seen, { viewerKey });
    }

    return qb.getMany();
  }

  /** One video, by id. Public for a READY one; the author sees their own. */
  async detail(id: string, viewerId: string | null): Promise<VideoResponse> {
    const video = await this.videos.findOneBy({ id });
    if (!video) throw new NotFoundException('Video not found');

    const visible =
      video.status === VideoStatus.READY || video.authorId === viewerId;
    if (!visible) throw new NotFoundException('Video not found');

    return (await this.shapeMany([video], viewerId))[0];
  }

  /**
   * The author's own shelf, every status included — the screen that answers
   * "where is the clip I uploaded five minutes ago".
   */
  async mine(userId: string, q: MyVideosQueryDto) {
    const limit = q.limit ?? 20;
    const offset = q.offset ?? 0;

    const [rows, total] = await this.videos.findAndCount({
      where: { authorId: userId },
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });

    return { total, items: await this.shapeMany(rows, userId) };
  }

  /** Someone's public reels, for their profile. */
  async byAuthor(
    authorId: string,
    viewerId: string | null,
    q: MyVideosQueryDto,
  ) {
    const limit = q.limit ?? 20;
    const offset = q.offset ?? 0;

    const [rows, total] = await this.videos.findAndCount({
      where: { authorId, status: VideoStatus.READY },
      order: { publishedAt: 'DESC' },
      take: limit,
      skip: offset,
    });

    return { total, items: await this.shapeMany(rows, viewerId) };
  }

  /**
   * The clips on a listing page, newest first.
   *
   * A listing may end up with several over its life (a second film after a
   * renovation, say); the page shows the newest and the rest are reachable
   * from the feed.
   */
  async byListing(listingId: string, viewerId: string | null) {
    const rows = await this.videos.find({
      where: { listingId, status: VideoStatus.READY },
      order: { publishedAt: 'DESC' },
      take: 10,
    });
    return { items: await this.shapeMany(rows, viewerId) };
  }

  // ---- Editing and removal ---------------------------------------------

  /** Caption and listing link. Neither re-ranks an already published video. */
  async update(videoId: string, userId: string, dto: UpdateVideoDto) {
    const video = await this.mustOwn(videoId, userId);

    const patch: Partial<Video> = {};
    if (dto.caption !== undefined) patch.caption = dto.caption || null;
    if (dto.listingId !== undefined) {
      patch.listingId = dto.listingId
        ? (await this.mustOwnListing(dto.listingId, userId)).id
        : null;
    }

    if (Object.keys(patch).length) await this.videos.update(video.id, patch);
    return this.detail(videoId, userId);
  }

  /**
   * The dashboard's edit.
   *
   * Narrower than it looks, and deliberately so. A moderator fixes a caption
   * — a phone number where the rules say none, a wall of keywords, somebody
   * else's address — and corrects or clears a listing link that points at
   * the wrong advert. Everything else about a reel (the footage, who posted
   * it, what it cost, when it published) is not editable by anybody, here or
   * in the app, because none of it is a mistake that can be corrected after
   * the fact.
   *
   * The listing is still checked against the VIDEO'S AUTHOR rather than
   * against the admin doing the editing. "A reel points at one of its own
   * author's listings" is an invariant both the feed and the listing page
   * read; an admin pointing a clip at a stranger's advert would quietly
   * break both, and would hand one seller's video to another seller's page.
   */
  async adminUpdate(videoId: string, dto: UpdateVideoDto) {
    const video = await this.videos.findOneBy({ id: videoId });
    if (!video) throw new NotFoundException('Video not found');

    const patch: Partial<Video> = {};
    if (dto.caption !== undefined) patch.caption = dto.caption || null;
    if (dto.listingId !== undefined) {
      patch.listingId = dto.listingId
        ? (await this.mustOwnListing(dto.listingId, video.authorId)).id
        : null;
    }

    if (Object.keys(patch).length) await this.videos.update(video.id, patch);
    return this.adminDetail(videoId);
  }

  /**
   * Take a video down.
   *
   * The row stays, and so does the file for VIDEO_RETENTION_DAYS: a takedown
   * is a decision somebody may have to justify later, and a deleted row
   * justifies nothing. Nothing is refunded — the posting fee bought the
   * publication, which happened.
   */
  async remove(
    videoId: string,
    actorId: string,
    role: UserRole,
    reason?: string,
  ) {
    const video = await this.videos.findOneBy({ id: videoId });
    if (!video) throw new NotFoundException('Video not found');

    const isAdmin = role === UserRole.ADMIN;
    if (video.authorId !== actorId && !isAdmin) {
      throw new ForbiddenException({
        code: 'NOT_YOUR_VIDEO',
        message: 'This is not your video',
      });
    }

    if (video.status === VideoStatus.REMOVED) return { success: true };

    await this.videos.update(video.id, {
      status: VideoStatus.REMOVED,
      removedAt: new Date(),
      removedBy: isAdmin && video.authorId !== actorId ? actorId : null,
      removeReason: reason ?? null,
    });

    this.logger.log(
      `Video ${video.id} removed by ${actorId}${reason ? `: ${reason}` : ''}`,
    );
    return { success: true };
  }

  // ---- Admin -----------------------------------------------------------

  async adminList(q: AdminVideosQueryDto) {
    const limit = q.limit ?? 25;
    const offset = q.offset ?? 0;

    const qb = this.videos
      .createQueryBuilder('v')
      .orderBy('v.created_at', 'DESC')
      .limit(limit)
      .offset(offset);

    if (q.status) qb.andWhere('v.status = :status', { status: q.status });
    if (q.authorId)
      qb.andWhere('v.author_id = :authorId', { authorId: q.authorId });
    if (q.listingId)
      qb.andWhere('v.listing_id = :listingId', { listingId: q.listingId });
    if (q.q) qb.andWhere('v.caption ILIKE :q', { q: `%${q.q}%` });

    const [rows, total] = await qb.getManyAndCount();
    return { total, limit, offset, items: await this.shapeMany(rows, null) };
  }

  /**
   * One video for the dashboard, in whatever state it is in — including the
   * failures, which is most of what an upload problem looks like from here.
   */
  async adminDetail(id: string): Promise<VideoResponse> {
    const video = await this.videos.findOneBy({ id });
    if (!video) throw new NotFoundException('Video not found');
    return (await this.shapeMany([video], null))[0];
  }

  /**
   * The overview's video numbers.
   *
   * `awaitingPayment` is the one worth watching: a pile of it means people
   * are filming and then finding out they cannot afford to post, which is a
   * pricing problem rather than a technical one.
   */
  async adminStats() {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [total, published, awaitingPayment, failed, newThisWeek] =
      await Promise.all([
        this.videos.count(),
        this.videos.count({ where: { status: VideoStatus.READY } }),
        this.videos.count({ where: { status: VideoStatus.AWAITING_PAYMENT } }),
        this.videos.count({ where: { status: VideoStatus.FAILED } }),
        this.videos
          .createQueryBuilder('v')
          .where('v.created_at >= :since', { since })
          .getCount(),
      ]);

    return { total, published, awaitingPayment, failed, newThisWeek };
  }

  // ---- Internals -------------------------------------------------------

  /**
   * Where a video enters the feed.
   *
   * A clip that points at a listing is worth more to a property marketplace
   * than one that points nowhere, so it starts a few hours "younger" than it
   * is. Expressed as time rather than as a score so the whole feed is still
   * one indexed ORDER BY — see Video.rankAt.
   */
  private rankFor(publishedAt: Date, listingId: string | null): Date {
    if (!listingId) return publishedAt;
    return new Date(
      publishedAt.getTime() + LISTING_LINK_BOOST_HOURS * 60 * 60 * 1000,
    );
  }

  private async fail(video: Video, reason: VideoFailReason): Promise<void> {
    await this.videos.update(video.id, {
      status: VideoStatus.FAILED,
      failReason: reason,
    });
    // Nothing was charged, but something was expected: an upload that
    // vanishes without a word is indistinguishable from an app that lost it.
    await this.notifications.notify({
      userId: video.authorId,
      kind: NotificationKind.VIDEO_FAILED,
      videoId: video.id,
    });
    // Nothing was charged, so there is nothing to keep: the file is deleted
    // immediately rather than waiting for the retention sweep.
    await this.bunny.deleteVideo(video.providerId);
    await this.videos.update(video.id, { providerPurgedAt: new Date() });
  }

  /** Mirrors WalletService.debit's refusal, which is an HttpException. */
  private isInsufficientFunds(error: unknown): boolean {
    if (!(error instanceof HttpException)) return false;
    const body = error.getResponse();
    return (
      typeof body === 'object' &&
      body !== null &&
      (body as { code?: string }).code === 'INSUFFICIENT_FUNDS'
    );
  }

  private async assertUnderDailyLimit(userId: string): Promise<void> {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const used = await this.videos
      .createQueryBuilder('v')
      .where('v.author_id = :userId', { userId })
      .andWhere('v.created_at > :since', { since })
      // Only attempts that cost something are counted: a clip Bunny rejected
      // for being 90 seconds long should not use up the day's quota.
      .andWhere('v.status NOT IN (:...ignored)', {
        ignored: [VideoStatus.FAILED, VideoStatus.EXPIRED],
      })
      .getCount();

    if (used >= VIDEO_DAILY_LIMIT) {
      throw new HttpException(
        {
          code: 'VIDEO_DAILY_LIMIT',
          message: `You can post ${VIDEO_DAILY_LIMIT} videos a day`,
          limit: VIDEO_DAILY_LIMIT,
        },
        429,
      );
    }
  }

  /**
   * What posting will cost, and whether this wallet can cover it — asked
   * before the upload so nobody spends 30 MB of mobile data to be told no.
   *
   * Returns the price for the app to show, or null when the action is free
   * (no active VIDEO_POST tariff, or an admin account). Deliberately NOT a
   * reservation: a hold would have to be released on every failure path,
   * including the ones where the phone simply walks out of signal.
   */
  private async priceCheck(userId: string): Promise<string | null> {
    const tariff = await this.tariffs.findOne({
      where: { action: 'VIDEO_POST', isActive: true },
    });
    if (!tariff || Number(tariff.price) <= 0) return null;

    const user = await this.users.findOne({
      where: { id: userId },
      select: { id: true, role: true },
    });
    if (user?.role === UserRole.ADMIN) return null;

    const balance = await this.wallet.getBalance(this.ds.manager, userId);
    if (Number(balance) < Number(tariff.price)) {
      throw new HttpException(
        {
          code: 'INSUFFICIENT_FUNDS',
          message: `Need ${tariff.price} so'm, balance is ${balance}`,
          required: tariff.price,
          balance,
        },
        402,
      );
    }

    return tariff.price;
  }

  private async mustOwn(videoId: string, userId: string): Promise<Video> {
    const video = await this.videos.findOneBy({ id: videoId });
    if (!video) throw new NotFoundException('Video not found');
    if (video.authorId !== userId) {
      throw new ForbiddenException({
        code: 'NOT_YOUR_VIDEO',
        message: 'This is not your video',
      });
    }
    return video;
  }

  private async mustOwnListing(
    listingId: string,
    userId: string,
  ): Promise<Listing> {
    const listing = await this.listings.findOne({
      where: { id: listingId },
      select: { id: true, ownerId: true, title: true, status: true },
    });
    if (!listing) throw new NotFoundException('Listing not found');
    if (listing.ownerId !== userId) {
      throw new ForbiddenException({
        code: 'NOT_YOUR_LISTING',
        message: 'This is not your listing',
      });
    }
    // A draft is fine — people film the flat and post the advert in one
    // sitting — but an archived one is a listing nobody can open.
    if (listing.status === ListingStatus.ARCHIVED) {
      throw new BadRequestException({
        code: 'LISTING_UNAVAILABLE',
        message: 'This listing is not available',
      });
    }
    return listing;
  }

  // ---- Shaping ---------------------------------------------------------

  /**
   * Rows → what the app reads, hydrating authors, listing cards and the
   * viewer's own likes in three queries for the whole page rather than three
   * per video. The feed is twenty rows; the per-row version is sixty round
   * trips per swipe.
   */
  private async shapeMany(
    rows: Video[],
    viewerId: string | null,
  ): Promise<VideoResponse[]> {
    if (!rows.length) return [];

    const [authors, listings, liked] = await Promise.all([
      this.authorMap(rows.map((v) => v.authorId)),
      this.listingMap(
        rows.map((v) => v.listingId).filter((id): id is string => !!id),
      ),
      this.likedSet(
        viewerId,
        rows.map((v) => v.id),
      ),
    ]);

    return rows.map((v) => ({
      id: v.id,
      authorId: v.authorId,
      listingId: v.listingId,
      status: v.status,
      failReason: v.failReason,
      caption: v.caption,
      durationSec: v.durationSec,
      width: v.width,
      height: v.height,
      // Null until the file is playable, which is how the app tells "still
      // processing" from "ready to watch". Duration is written in the same
      // update that accepts the encode, so it is the honest signal for it.
      hlsUrl: v.durationSec != null ? this.bunny.hlsUrl(v.providerId) : null,
      thumbUrl: this.bunny.thumbnailUrl(v.providerId, v.thumbnailFile),
      embedUrl: this.bunny.embedUrl(v.providerId),
      likeCount: v.likeCount,
      commentCount: v.commentCount,
      viewCount: v.viewCount,
      likedByMe: liked.has(v.id),
      publishedAt: v.publishedAt?.toISOString() ?? null,
      createdAt: v.createdAt.toISOString(),
      author: authors.get(v.authorId) ?? null,
      listing: v.listingId ? (listings.get(v.listingId) ?? null) : null,
    }));
  }

  private async authorMap(ids: string[]): Promise<Map<string, VideoAuthor>> {
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

    return new Map(
      rows.map((u) => [
        u.id,
        {
          id: u.id,
          name: u.name,
          surname: u.surname,
          avatarThumbUrl: u.avatarThumbUrl,
          isVerifiedRealtor: u.isVerifiedRealtor,
        },
      ]),
    );
  }

  /**
   * The listing behind the "open the listing" button: its title, its primary
   * photo and its cheapest active price.
   *
   * One query with two lateral joins rather than loading listings with their
   * relations — the card needs five columns, not a listing.
   *
   * Only ACTIVE listings come back, so the "open the listing" button quietly
   * disappears once the advert is archived while the reel itself stays up.
   * A button that opens a listing nobody can see is worse than no button.
   */
  private async listingMap(
    ids: string[],
  ): Promise<Map<string, VideoListingCard>> {
    const unique = [...new Set(ids)];
    if (!unique.length) return new Map();

    const rows: {
      id: string;
      title: string | null;
      thumb_url: string | null;
      price: string | null;
      currency: string | null;
      purpose: string | null;
    }[] = await this.listings.query(
      `SELECT l.id, l.title, img.thumb_url, o.price::text, o.currency, o.purpose::text
         FROM listings l
         LEFT JOIN LATERAL (
           SELECT thumb_url FROM listing_images
            WHERE listing_id = l.id
            ORDER BY is_primary DESC, position ASC
            LIMIT 1
         ) img ON TRUE
         LEFT JOIN LATERAL (
           SELECT price, currency, purpose FROM listing_offers
            WHERE listing_id = l.id AND is_active = TRUE
            ORDER BY price ASC
            LIMIT 1
         ) o ON TRUE
        WHERE l.id = ANY($1::uuid[]) AND l.status = 'ACTIVE'`,
      [unique],
    );

    return new Map(
      rows.map((r) => [
        r.id,
        {
          id: r.id,
          title: r.title,
          thumbUrl: r.thumb_url,
          price: r.price,
          currency: r.currency,
          purpose: r.purpose,
        },
      ]),
    );
  }

  private async likedSet(
    viewerId: string | null,
    videoIds: string[],
  ): Promise<Set<string>> {
    if (!viewerId || !videoIds.length) return new Set();

    const rows = await this.likes.find({
      where: { userId: viewerId, videoId: In(videoIds) },
      select: { videoId: true },
    });
    return new Set(rows.map((r) => r.videoId));
  }

  private encodeCursor(phase: FeedPhase, last: Video): string {
    // rank_at is never null on a READY row — it is written in the same update
    // that publishes it — but fall back rather than emit "null" in a cursor.
    const rank = (
      last.rankAt ??
      last.publishedAt ??
      last.createdAt
    ).toISOString();
    return `${phase}:${rank}|${last.id}`;
  }

  private decodeCursor(raw?: string): FeedCursor | null {
    if (!raw) return null;

    const match = /^([usa]):(.+)\|([0-9a-f-]{36})$/i.exec(raw);
    if (!match) {
      throw new BadRequestException({
        code: 'BAD_CURSOR',
        message: 'Invalid cursor',
      });
    }

    const [, phase, rankAt, id] = match;
    if (Number.isNaN(Date.parse(rankAt))) {
      throw new BadRequestException({
        code: 'BAD_CURSOR',
        message: 'Invalid cursor',
      });
    }

    return { phase: phase as FeedPhase, rankAt, id };
  }
}
