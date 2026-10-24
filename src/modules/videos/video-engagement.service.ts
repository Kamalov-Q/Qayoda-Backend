import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Video } from './entities/video.entity';
import { VideoView } from './entities/video-view.entity';
import { VideoStatus, VIEW_MIN_WATCH_MS } from './videos.constants';
import type { ReportViewsDto } from './dto/video.dto';

export interface LikeResult {
  liked: boolean;
  likeCount: number;
}

/**
 * Likes and views — both counters on a video, in one place.
 *
 * Deliberately one small service rather than two sprinkled through the
 * feature. Both are the same shape of problem (a row is the truth, a column
 * is the cache of it) and both are the thing that has to move to
 * Redis the day a clip goes properly viral, because `UPDATE videos SET
 * like_count = like_count + 1` serialises every liker of that one video
 * behind one row lock. At a thousand users that is free; the point of the
 * boundary is that the change is one file when it stops being free.
 */
@Injectable()
export class VideoEngagementService {
  constructor(
    @InjectRepository(Video) private readonly videos: Repository<Video>,
    @InjectRepository(VideoView) private readonly views: Repository<VideoView>,
  ) {}

  /**
   * Like or unlike, idempotently in both directions.
   *
   * The counter only moves when the row did: liking twice is one like, and a
   * double tap on a slow connection cannot inflate anything. Returns the
   * fresh count so the app can replace its optimistic guess with the truth.
   */
  async setLike(
    videoId: string,
    userId: string,
    liked: boolean,
  ): Promise<LikeResult> {
    await this.mustBePublished(videoId);

    // One statement, so the row and the counter can never disagree: the CTE
    // writes (or deletes) the like and the UPDATE moves the counter by how
    // many rows that actually touched — zero for a repeat tap.
    const sql = liked
      ? `WITH ins AS (
           INSERT INTO video_likes (video_id, user_id) VALUES ($1, $2)
           ON CONFLICT (video_id, user_id) DO NOTHING
           RETURNING 1
         )
         UPDATE videos
            SET like_count = like_count + (SELECT count(*) FROM ins)
          WHERE id = $1
         RETURNING like_count`
      : `WITH del AS (
           DELETE FROM video_likes WHERE video_id = $1 AND user_id = $2
           RETURNING 1
         )
         UPDATE videos
            SET like_count = GREATEST(like_count - (SELECT count(*) FROM del), 0)
          WHERE id = $1
         RETURNING like_count`;

    // TypeORM answers UPDATE … RETURNING with [rows, affectedCount].
    const [rows]: [{ like_count: number }[], number] = await this.videos.query(
      sql,
      [videoId, userId],
    );

    return { liked, likeCount: rows[0]?.like_count ?? 0 };
  }

  /**
   * Record a batch of views.
   *
   * Batched because a reel feed is a swipe every two seconds: one request per
   * view would be a request per swipe, which is both a lot of HTTP for
   * nothing and a reliable way to be rate-limited by your own API. The app
   * keeps a small list and flushes it every few seconds and on leaving the
   * screen.
   *
   * A view is a person who watched for VIEW_MIN_WATCH_MS, counted once, ever.
   * One row per (video, viewer) is what makes the number "how many people"
   * rather than "how many loops" — and a reel loops forever if you let it.
   *
   * The whole batch is one statement. `xmax = 0` is the standard way to ask
   * an upsert which rows were genuinely new, so a second report of the same
   * view updates how long they watched without touching the count.
   */
  async recordViews(
    dto: ReportViewsDto,
    userId: string | null,
    deviceId: string | null,
  ): Promise<{ counted: number }> {
    const viewerKey = userId
      ? `u:${userId}`
      : deviceId
        ? `d:${deviceId}`
        : null;
    // Nothing to deduplicate on means the number would become a loop count.
    if (!viewerKey) return { counted: 0 };

    // Longest watch wins, and each video appears once: ON CONFLICT DO UPDATE
    // refuses to touch the same row twice in one statement, and a batch from
    // a looping player legitimately carries the same id more than once.
    const longest = new Map<string, number>();
    for (const view of dto.views) {
      if (view.watchedMs < VIEW_MIN_WATCH_MS) continue;
      const seen = longest.get(view.videoId) ?? 0;
      if (view.watchedMs > seen) longest.set(view.videoId, view.watchedMs);
    }
    if (!longest.size) return { counted: 0 };

    const ids = [...longest.keys()];
    const durations = ids.map((id) => longest.get(id)!);

    const rows: { counted: number }[] = await this.views.query(
      `WITH incoming AS (
         SELECT * FROM unnest($1::uuid[], $2::int[]) AS t(video_id, watched_ms)
       ), ins AS (
         INSERT INTO video_views (video_id, viewer_key, user_id, watched_ms)
         SELECT i.video_id, $3, $4::uuid, i.watched_ms
           FROM incoming i
           -- The ids come from the client, so only published videos count.
           JOIN videos v ON v.id = i.video_id AND v.status = 'READY'
         ON CONFLICT (video_id, viewer_key) DO UPDATE
           SET watched_ms = GREATEST(video_views.watched_ms, EXCLUDED.watched_ms)
         RETURNING video_id, (xmax = 0) AS fresh
       ), bumped AS (
         UPDATE videos SET view_count = view_count + 1
          WHERE id IN (SELECT video_id FROM ins WHERE fresh)
         RETURNING id
       )
       SELECT count(*)::int AS counted FROM bumped`,
      [ids, durations, viewerKey, userId],
    );

    return { counted: rows[0]?.counted ?? 0 };
  }

  private async mustBePublished(videoId: string): Promise<void> {
    const exists = await this.videos.existsBy({
      id: videoId,
      status: VideoStatus.READY,
    });
    if (!exists) throw new NotFoundException('Video not found');
  }
}
