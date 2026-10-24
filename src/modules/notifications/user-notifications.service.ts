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

export interface NotifyInput {
  /** Who is being told. */
  userId: string;
  kind: NotificationKind;
  /** Who did it. Omitted when the platform is the actor. */
  actorId?: string | null;
  videoId?: string | null;
  commentId?: string | null;
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
  ) {}

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

      await this.notifications.insert({
        userId: input.userId,
        kind: input.kind,
        actorId: input.actorId ?? null,
        videoId: input.videoId ?? null,
        commentId: input.commentId ?? null,
      });
    } catch (error) {
      this.logger.warn(
        `Notification ${input.kind} for ${input.userId} not written: ${
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

    const [actors, videos] = await Promise.all([
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
    ]);

    const actorById = new Map(actors.map((a) => [a.id, a] as const));
    const videoById = new Map(videos.map((v) => [v.id, v] as const));

    return {
      total,
      items: rows.map((r) => {
        const actor = r.actorId ? actorById.get(r.actorId) : undefined;
        const video = r.videoId ? videoById.get(r.videoId) : undefined;

        return {
          id: r.id,
          kind: r.kind,
          videoId: r.videoId,
          commentId: r.commentId,
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
