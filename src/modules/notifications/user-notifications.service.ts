import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, LessThan, Repository } from 'typeorm';
import { UserNotification } from './entities/user-notification.entity';
import {
  LIKE_DEDUPE_HOURS,
  NOTIFICATIONS_PAGE,
  NotificationKind,
} from './notifications.constants';
import { User } from '../users/entities/user.entity';
import { Video } from '../videos/entities/video.entity';
import { Listing } from '../listings/entities/listing.entity';
import { ListingImage } from '../listings/entities/listing-image.entity';
import { ExpoPushService, type PushTo } from './expo-push.service';
import { PUSH_TEXT } from './push-text';

export interface NotifyInput {
  /** Who is being told. */
  userId: string;
  kind: NotificationKind;
  /** Who did it. Omitted when the platform is the actor. */
  actorId?: string | null;
  videoId?: string | null;
  commentId?: string | null;
  /** Listing comments, replies and reviews — what the row opens. */
  listingId?: string | null;
  /** Chat. One unread row per conversation, never one per message. */
  conversationId?: string | null;
  /** Amounts, providers, tariff names: printed, never joined to. */
  meta?: Record<string, unknown> | null;
}

/**
 * The inbox: writing to it, and reading it back.
 *
 * Every caller is a side effect of something else — a like, a comment, a
 * video going live — so nothing in here may throw into its caller's path.
 * A notification that failed to write is a notification nobody got; a like
 * that failed because its notification did is a bug in the like.
 */
@Injectable()
export class UserNotificationsService {
  private readonly logger = new Logger(UserNotificationsService.name);

  constructor(
    @InjectRepository(UserNotification)
    private readonly notifications: Repository<UserNotification>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Video) private readonly videos: Repository<Video>,
    @InjectRepository(Listing) private readonly listings: Repository<Listing>,
    @InjectRepository(ListingImage)
    private readonly listingImages: Repository<ListingImage>,
    private readonly push: ExpoPushService,
  ) {}

  /**
   * The push that mirrors a row we just wrote.
   *
   * Fire-and-forget, and deliberately NOT awaited by notify(): the inbox is
   * the source of truth and a device that cannot be reached must not slow
   * down — or fail — the thing that caused the notification. The bell picks
   * it up on the next poll either way.
   *
   * `data` carries the same references the row does, so a tap from the lock
   * screen lands exactly where a tap in the inbox would.
   *
   * `notificationId` is what lets it do the other half. A tap used to open
   * the screen and leave the row unread, so the bell still claimed one
   * unread after the user had read exactly that thing — and the inbox,
   * reached some other way later, showed it washed as new. With the id on
   * the payload the client marks that single row read as it navigates.
   */
  private pushFor(input: NotifyInput, notificationId: string | null): void {
    const text = PUSH_TEXT[input.kind];
    if (!text) return;

    void this.push.sendToUsers([input.userId], {
      title: text.title,
      body: text.body,
      data: {
        kind: input.kind,
        notificationId,
        actorId: input.actorId ?? null,
        videoId: input.videoId ?? null,
        listingId: input.listingId ?? null,
        conversationId: input.conversationId ?? null,
      },
    });
  }

  /**
   * Tell someone. Never throws, and never tells you about yourself — the
   * author of a video does not need to hear that they liked it.
   */
  async notify(input: NotifyInput): Promise<void> {
    try {
      if (!input.userId) return;
      if (input.actorId && input.actorId === input.userId) return;

      // Liking, unliking and liking again is one event to the person on the
      // other end. Inside the window, an unread like from the same person
      // about the same video is not written twice.
      if (input.kind === NotificationKind.VIDEO_LIKE && input.videoId) {
        const since = new Date(Date.now() - LIKE_DEDUPE_HOURS * 3600_000);
        const existing = await this.notifications.findOne({
          where: {
            userId: input.userId,
            kind: NotificationKind.VIDEO_LIKE,
            videoId: input.videoId,
            actorId: input.actorId ?? IsNull(),
            readAt: IsNull(),
          },
          select: { id: true, createdAt: true },
        });
        if (existing && existing.createdAt > since) return;
      }

      // Chat collapses per thread: fifty messages in one conversation is
      // one claim on attention, and fifty rows is how an inbox teaches
      // people to stop opening it. Touching the existing unread row rather
      // than inserting keeps it at the top of the list with the latest
      // sender on it.
      //
      // ON CONFLICT against uq_notifications_unread_conversation, so two
      // messages arriving at once cannot race into two rows — the unique
      // partial index decides, not a read-then-write in this process.
      //
      // The WHERE must match that index's predicate, `kind` included: it is
      // how Postgres infers which index is the arbiter, and an inference
      // that does not imply the predicate matches no index at all and
      // raises 42P10 on every chat notification. The kind is constant here
      // anyway — this branch is only reached for CHAT_MESSAGE.
      if (input.kind === NotificationKind.CHAT_MESSAGE && input.conversationId) {
        //
        // RETURNING works on both arms of the upsert, so this is the id of
        // the row the reader will actually see — the fresh insert, or the
        // existing unread row the new message was folded into. Either way
        // it is the one a tap should mark read.
        const upserted: { id: string }[] = await this.notifications.query(
          `INSERT INTO user_notifications
             (user_id, kind, actor_id, conversation_id)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (user_id, conversation_id)
             WHERE conversation_id IS NOT NULL
               AND read_at IS NULL
               AND kind = 'CHAT_MESSAGE'
           DO UPDATE SET actor_id = EXCLUDED.actor_id,
                         created_at = now()
           RETURNING id`,
          [input.userId, input.kind, input.actorId ?? null, input.conversationId],
        );
        this.pushFor(input, upserted[0]?.id ?? null);
        return;
      }

      // save() rather than insert(): insert's QueryDeepPartialEntity cannot
      // express a jsonb column whose type is an open Record, and the cast
      // that would silence it is the kind that hides a real mistake later.
      const saved = await this.notifications.save(
        this.notifications.create({
          userId: input.userId,
          kind: input.kind,
          actorId: input.actorId ?? null,
          videoId: input.videoId ?? null,
          commentId: input.commentId ?? null,
          listingId: input.listingId ?? null,
          conversationId: input.conversationId ?? null,
          meta: input.meta ?? null,
        }),
      );
      this.pushFor(input, saved.id);
    } catch (error) {
      this.logger.warn(
        `Notification ${input.kind} for ${input.userId} not written: ${
          (error as Error).message
        }`,
      );
    }
  }

  /**
   * Tell many people each a DIFFERENT thing, in one statement.
   *
   * notifyMany below is a fan-out: one event, one set of references, many
   * recipients. This is the opposite shape — a sweep that settles a page of
   * rows and owes each of them a notification about its own listing, thread
   * and amount. The bid-expiry cron does up to five hundred of those at a
   * time, and notify() in a loop made that five hundred awaited inserts with
   * the scheduler blocked on every one, plus five hundred unawaited pushes
   * each paying for its own token lookup and HTTP request.
   *
   * One insert and one batched push instead, with every row keeping its own
   * references so a tap still lands on the right listing.
   *
   * Same contract as the rest of this service: never throws. No dedupe
   * branch, for the reason notifyMany gives — the kinds that collapse are
   * per-person events that never arrive in a batch.
   */
  async notifyEach(inputs: NotifyInput[]): Promise<void> {
    try {
      const rows = inputs.filter(
        (i) => i.userId && (!i.actorId || i.actorId !== i.userId),
      );
      if (!rows.length) return;

      // save(), not insert(), for the reason notify() gives: insert's
      // QueryDeepPartialEntity cannot express a jsonb column whose type is
      // an open Record, and `meta` is where the amount on a bid row lives.
      // An array still goes to the database as a batched insert.
      // save() returns the rows in the order they were given, which is how
      // each push below finds its own row's id.
      const saved = await this.notifications.save(
        rows.map((i) =>
          this.notifications.create({
            userId: i.userId,
            kind: i.kind,
            actorId: i.actorId ?? null,
            videoId: i.videoId ?? null,
            commentId: i.commentId ?? null,
            listingId: i.listingId ?? null,
            conversationId: i.conversationId ?? null,
            meta: i.meta ?? null,
          }),
        ),
      );

      // Fire-and-forget, exactly as pushFor is: the inbox is the source of
      // truth and an unreachable device must not hold up a sweep. A kind
      // with no push text is inbox-only by design.
      const pushes: PushTo[] = [];
      rows.forEach((i, index) => {
        const text = PUSH_TEXT[i.kind];
        if (!text) return;
        pushes.push({
          userId: i.userId,
          payload: {
            title: text.title,
            body: text.body,
            data: {
              kind: i.kind,
              notificationId: saved[index]?.id ?? null,
              actorId: i.actorId ?? null,
              videoId: i.videoId ?? null,
              listingId: i.listingId ?? null,
              conversationId: i.conversationId ?? null,
            },
          },
        });
      });
      if (pushes.length) void this.push.sendEach(pushes);
    } catch (error) {
      this.logger.warn(
        `Batch of ${inputs.length} notification(s) not written: ${
          (error as Error).message
        }`,
      );
    }
  }

  /**
   * Tell many people the same thing, in one statement.
   *
   * notify() in a loop is one round trip per recipient, which for a fan-out
   * to five hundred followers is five hundred of them while a video publish
   * waits. This is the same contract — never throws, never tells you about
   * yourself — in a single insert.
   *
   * No dedupe branch: the kinds that collapse (chat, likes) are per-person
   * events and never arrive as a fan-out.
   *
   * save(), not insert(), for two reasons that used to be bugs:
   *
   *  - insert()'s QueryDeepPartialEntity cannot express a jsonb column whose
   *    type is an open Record, so `meta` was simply left out of the mapping
   *    — accepted by the signature, silently dropped on the way to the
   *    database. No caller passed one yet, which is the only reason it was
   *    not visible; the next one to try would have lost its amount.
   *  - the rows have to come back, because each recipient's push carries its
   *    own row id now.
   *
   * Written after the insert rather than before it, also for a reason: a
   * push about a row that failed to write is a banner that opens an inbox
   * with nothing in it.
   */
  async notifyMany(
    userIds: string[],
    input: Omit<NotifyInput, 'userId'>,
  ): Promise<void> {
    try {
      const recipients = [...new Set(userIds)].filter(
        (id) => id && id !== input.actorId,
      );
      if (!recipients.length) return;

      const saved = await this.notifications.save(
        recipients.map((userId) =>
          this.notifications.create({
            userId,
            kind: input.kind,
            actorId: input.actorId ?? null,
            videoId: input.videoId ?? null,
            commentId: input.commentId ?? null,
            listingId: input.listingId ?? null,
            conversationId: input.conversationId ?? null,
            meta: input.meta ?? null,
          }),
        ),
      );

      const text = PUSH_TEXT[input.kind];
      if (!text) return;

      // sendEach rather than sendToUsers: the title and body are identical
      // for everyone, but `notificationId` is not, and that is the field a
      // tap needs to mark the right row read. Still one token query and one
      // request per hundred devices.
      void this.push.sendEach(
        recipients.map((userId, index) => ({
          userId,
          payload: {
            title: text.title,
            body: text.body,
            data: {
              kind: input.kind,
              notificationId: saved[index]?.id ?? null,
              actorId: input.actorId ?? null,
              videoId: input.videoId ?? null,
              listingId: input.listingId ?? null,
              conversationId: input.conversationId ?? null,
            },
          },
        })),
      );
    } catch (error) {
      this.logger.warn(
        `Fan-out of ${input.kind} to ${userIds.length} failed: ${
          (error as Error).message
        }`,
      );
    }
  }

  /** The inbox, newest first, hydrated with whoever and whatever it is about. */
  async list(userId: string, limit = NOTIFICATIONS_PAGE, offset = 0) {
    const [rows, total] = await this.notifications.findAndCount({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: Math.min(limit, NOTIFICATIONS_PAGE),
      skip: offset,
    });

    const actorIds = [...new Set(rows.map((r) => r.actorId).filter(Boolean))];
    const videoIds = [...new Set(rows.map((r) => r.videoId).filter(Boolean))];
    const listingIds = [
      ...new Set(rows.map((r) => r.listingId).filter(Boolean)),
    ];

    const [actors, videos, listings, covers] = await Promise.all([
      actorIds.length
        ? this.users.find({
            where: { id: In(actorIds as string[]) },
            select: {
              id: true,
              name: true,
              surname: true,
              avatarThumbUrl: true,
            },
          })
        : Promise.resolve<User[]>([]),
      videoIds.length
        ? this.videos.find({
            where: { id: In(videoIds as string[]) },
            select: {
              id: true,
              caption: true,
              status: true,
              providerId: true,
              thumbnailFile: true,
            },
          })
        : Promise.resolve<Video[]>([]),
      // Just enough of the listing to say WHICH one.
      listingIds.length
        ? this.listings.find({
            where: { id: In(listingIds as string[]) },
            select: { id: true, title: true, status: true },
          })
        : Promise.resolve<Listing[]>([]),
      // The cover, in ONE query for the whole page rather than a join per
      // row — which is why this was left out before. A video row has had a
      // thumbnail from the start and a listing row had a grey icon, so the
      // half of the inbox that is about the actual product was the half you
      // could not skim. `thumb_url` only: the full image is never shown at
      // 34pt.
      listingIds.length
        ? this.listingImages.find({
            where: { listingId: In(listingIds as string[]) },
            select: { listingId: true, thumbUrl: true, isPrimary: true, position: true },
            order: { isPrimary: 'DESC', position: 'ASC' },
          })
        : Promise.resolve<ListingImage[]>([]),
    ]);

    const actorById = new Map(actors.map((a) => [a.id, a] as const));
    const videoById = new Map(videos.map((v) => [v.id, v] as const));
    const listingById = new Map(listings.map((l) => [l.id, l] as const));
    // First wins: the rows arrive primary-first, then by position, so the
    // first one seen for a listing is its cover.
    const coverByListing = new Map<string, string>();
    for (const image of covers) {
      if (!coverByListing.has(image.listingId)) {
        coverByListing.set(image.listingId, image.thumbUrl);
      }
    }

    return {
      total,
      items: rows.map((r) => {
        const actor = r.actorId ? actorById.get(r.actorId) : undefined;
        const video = r.videoId ? videoById.get(r.videoId) : undefined;
        const listing = r.listingId
          ? listingById.get(r.listingId)
          : undefined;

        return {
          id: r.id,
          kind: r.kind,
          videoId: r.videoId,
          commentId: r.commentId,
          listingId: r.listingId,
          conversationId: r.conversationId,
          // Amounts, providers, tariff names — printed by the row, joined to
          // by nothing.
          meta: r.meta,
          read: r.readAt != null,
          createdAt: r.createdAt.toISOString(),
          actor: actor
            ? {
                id: actor.id,
                name: actor.name,
                surname: actor.surname,
                avatarThumbUrl: actor.avatarThumbUrl,
              }
            : null,
          // Enough of the video to draw a row and navigate back into it. The
          // thumbnail URL is built here rather than stored, the same way the
          // feed does it.
          video: video
            ? {
                id: video.id,
                caption: video.caption,
                status: video.status,
                thumbUrl: video.thumbnailFile
                  ? `${process.env.BUNNY_STREAM_CDN_URL?.replace(/\/+$/, '')}/${
                      video.providerId
                    }/${video.thumbnailFile}`
                  : null,
              }
            : null,
          /** Which listing the comment, reply, review or bid was about. */
          listing: listing
            ? {
                id: listing.id,
                title: listing.title,
                // So a row can say the advert is gone instead of opening a
                // 404 — the same thing /me/bids reports for its own list.
                status: listing.status,
                thumbUrl: coverByListing.get(listing.id) ?? null,
              }
            : null,
        };
      }),
    };
  }

  /** The number on the bell. */
  unreadCount(userId: string): Promise<number> {
    return this.notifications.countBy({ userId, readAt: IsNull() });
  }

  /**
   * Mark some, or all, as read.
   *
   * Opening the inbox marks everything: a per-row read state that the UI
   * never shows is bookkeeping nobody can act on, and "unread" here means
   * "has not looked at the list since".
   */
  async markRead(userId: string, ids?: string[]): Promise<{ read: number }> {
    const result = await this.notifications.update(
      {
        userId,
        readAt: IsNull(),
        ...(ids?.length ? { id: In(ids) } : {}),
      },
      { readAt: new Date() },
    );
    return { read: result.affected ?? 0 };
  }

  /**
   * Housekeeping: an inbox nobody prunes is a table that only grows. Read
   * notifications older than the window are gone; unread ones stay, however
   * old, because they are the only record that somebody was told.
   */
  async pruneRead(olderThanDays = 60): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanDays * 86_400_000);
    const result = await this.notifications.delete({
      readAt: LessThan(cutoff),
    });
    return result.affected ?? 0;
  }
}
