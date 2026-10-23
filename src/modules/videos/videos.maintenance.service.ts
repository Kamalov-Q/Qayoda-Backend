import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, LessThan, Repository } from 'typeorm';
import { Video } from './entities/video.entity';
import {
  VIDEO_ABANDON_HOURS,
  VIDEO_AWAITING_PAYMENT_HOURS,
  VIDEO_RESYNC_AFTER_MIN,
  VIDEO_RETENTION_DAYS,
  VideoFailReason,
  VideoStatus,
} from './videos.constants';
import { BunnyStreamService } from './bunny-stream.service';
import { VideosService } from './videos.service';

/** How many rows one sweep will touch. Keeps a backlog from becoming a stall. */
const BATCH = 50;

const hoursAgo = (h: number) => new Date(Date.now() - h * 60 * 60 * 1000);

/**
 * The jobs that keep the videos table honest when nothing goes to plan.
 *
 * Every one of them exists because the happy path has a third party in it.
 * Bunny's webhook is one HTTP call from someone else's network to ours: most
 * arrive, some do not, and a video stuck in UPLOADING forever is a video the
 * author paid attention to and got nothing for. So the server also asks.
 *
 * All four are idempotent and bounded, and all four are safe to run twice —
 * which matters, because the day this API runs on two instances they will
 * both fire unless the crons are pinned to one.
 */
@Injectable()
export class VideosMaintenanceService {
  private readonly logger = new Logger(VideosMaintenanceService.name);

  constructor(
    @InjectRepository(Video) private readonly videos: Repository<Video>,
    private readonly bunny: BunnyStreamService,
    private readonly videosService: VideosService,
  ) {}

  /**
   * The lost-webhook net: anything that has been uploading for a quarter of
   * an hour is asked about directly.
   *
   * Cheap — one Bunny API call per stuck video, and in a healthy system the
   * query returns nothing at all.
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async resyncStuckUploads(): Promise<void> {
    if (!this.bunny.configured) return;

    const stuck = await this.videos.find({
      where: {
        status: VideoStatus.UPLOADING,
        updatedAt: LessThan(
          new Date(Date.now() - VIDEO_RESYNC_AFTER_MIN * 60_000),
        ),
      },
      order: { updatedAt: 'ASC' },
      take: BATCH,
    });
    if (!stuck.length) return;

    this.logger.log(`Resyncing ${stuck.length} stuck upload(s) with Bunny`);
    for (const video of stuck) {
      try {
        await this.videosService.finalize(video.providerId);
      } catch (error) {
        this.logger.warn(
          `Resync failed for ${video.id}: ${(error as Error).message}`,
        );
      }
    }
  }

  /**
   * Uploads that never happened, and videos nobody paid for.
   *
   * Both end the same way — the file is deleted at Bunny and nothing is
   * charged — and both are deliberately generous: a day to finish an upload
   * (people start one on mobile data and finish it on Wi-Fi at home), two
   * days to top up a wallet.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async expireStalled(): Promise<void> {
    const abandoned = await this.videos.find({
      where: {
        status: VideoStatus.UPLOADING,
        updatedAt: LessThan(hoursAgo(VIDEO_ABANDON_HOURS)),
      },
      take: BATCH,
    });

    for (const video of abandoned) {
      await this.videos.update(video.id, {
        status: VideoStatus.FAILED,
        failReason: VideoFailReason.ABANDONED,
      });
      await this.purge(video);
    }

    const unpaid = await this.videos.find({
      where: {
        status: VideoStatus.AWAITING_PAYMENT,
        updatedAt: LessThan(hoursAgo(VIDEO_AWAITING_PAYMENT_HOURS)),
      },
      take: BATCH,
    });

    for (const video of unpaid) {
      await this.videos.update(video.id, { status: VideoStatus.EXPIRED });
      await this.purge(video);
    }

    if (abandoned.length || unpaid.length) {
      this.logger.log(
        `Expired ${abandoned.length} abandoned upload(s) and ${unpaid.length} unpaid video(s)`,
      );
    }
  }

  /**
   * Retention: a removed video's file goes a month after the takedown.
   *
   * The row stays for good. A moderation decision that cannot be reviewed is
   * not a decision anybody can defend, and a row is bytes — it is the video
   * that costs money to keep.
   */
  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async purgeRemoved(): Promise<void> {
    const due = await this.videos.find({
      where: {
        status: In([
          VideoStatus.REMOVED,
          VideoStatus.FAILED,
          VideoStatus.EXPIRED,
        ]),
        providerPurgedAt: IsNull(),
        updatedAt: LessThan(hoursAgo(VIDEO_RETENTION_DAYS * 24)),
      },
      take: BATCH,
    });
    if (!due.length) return;

    this.logger.log(`Purging ${due.length} video file(s) at Bunny`);
    for (const video of due) await this.purge(video);
  }

  /**
   * The counters, recomputed from the rows that are the truth.
   *
   * Nightly and cheap at this size, and it is the answer to the one failure
   * mode a `SET x = x + 1` design has: a transaction that died between the
   * row and the counter. Drift here is invisible to everyone until the day
   * somebody counts by hand, so it is worth one query a night.
   */
  @Cron(CronExpression.EVERY_DAY_AT_5AM)
  async reconcileCounters(): Promise<void> {
    const [rows]: [{ id: string }[], number] = await this.videos.query(
      `UPDATE videos v
          SET like_count    = c.likes,
              view_count    = c.views,
              comment_count = c.comments
         FROM (
           SELECT x.id,
                  (SELECT count(*) FROM video_likes    WHERE video_id = x.id) AS likes,
                  (SELECT count(*) FROM video_views    WHERE video_id = x.id) AS views,
                  (SELECT count(*) FROM video_comments WHERE video_id = x.id) AS comments
             FROM videos x
            WHERE x.status = 'READY'
         ) c
        WHERE c.id = v.id
          AND (v.like_count    <> c.likes
            OR v.view_count    <> c.views
            OR v.comment_count <> c.comments)
       RETURNING v.id`,
    );

    if (rows?.length) {
      this.logger.warn(`Counter drift corrected on ${rows.length} video(s)`);
    }
  }

  /** Delete the file at Bunny and remember that we did. Never throws. */
  private async purge(video: Video): Promise<void> {
    await this.bunny.deleteVideo(video.providerId);
    await this.videos.update(video.id, { providerPurgedAt: new Date() });
  }
}
