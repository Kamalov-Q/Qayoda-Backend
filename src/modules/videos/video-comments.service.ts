import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Repository } from 'typeorm';
import {
  VideoComment,
  VideoCommentLike,
} from './entities/video-comment.entity';
import { Video } from './entities/video.entity';
import { User } from '../users/entities/user.entity';
import { VideoStatus } from './videos.constants';
import { UserRole } from '../../shared/enums';
import {
  CreateVideoCommentDto,
  VideoCommentsQueryDto,
} from './dto/video-comment.dto';

const DEFAULT_LIMIT = 20;

/** How many replies ride along with each top-level comment. */
const REPLY_PREVIEW = 2;

export interface VideoCommentAuthor {
  id: string;
  name: string | null;
  surname: string | null;
  avatarThumbUrl: string | null;
}

/**
 * The thread under a reel.
 *
 * Shaped field for field like the listing thread, so the app renders both
 * with the same components. What differs is who is in charge: under a
 * listing the advert's owner can delete other people's comments, here it is
 * the video's author — and there is no photo attachment, because a reel's
 * comment section is a conversation, not a second gallery.
 */
@Injectable()
export class VideoCommentsService {
  constructor(
    @InjectRepository(VideoComment)
    private readonly comments: Repository<VideoComment>,
    @InjectRepository(VideoCommentLike)
    private readonly likes: Repository<VideoCommentLike>,
    @InjectRepository(Video) private readonly videos: Repository<Video>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly ds: DataSource,
  ) {}

  /**
   * One page of the thread: top-level comments newest first, each with the
   * start of its own replies already attached.
   *
   * Newest first because the composer sits at the bottom of the screen — a
   * comment that lands off-screen reads as a comment that failed to post.
   * Replies stay oldest-first inside their parent, because an exchange only
   * makes sense read forward.
   */
  async list(
    videoId: string,
    viewerId: string | null,
    q: VideoCommentsQueryDto,
  ) {
    await this.mustExist(videoId);

    const limit = q.limit ?? DEFAULT_LIMIT;
    const offset = q.offset ?? 0;

    const [roots, total] = await this.comments.findAndCount({
      where: { videoId, parentId: IsNull() },
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });

    // The whole page's replies in one read, then cut to the preview size per
    // parent. A query per comment is what makes a thread slow.
    const rootIds = roots.map((r) => r.id);
    const replies = rootIds.length
      ? await this.comments.find({
          where: { parentId: In(rootIds) },
          order: { createdAt: 'ASC' },
        })
      : [];

    const byParent = new Map<string, VideoComment[]>();
    for (const reply of replies) {
      const list = byParent.get(reply.parentId!) ?? [];
      if (list.length < REPLY_PREVIEW) list.push(reply);
      byParent.set(reply.parentId!, list);
    }

    const all = [...roots, ...replies];
    const [authors, liked] = await Promise.all([
      this.authorMap(all.map((c) => c.authorId)),
      this.likedSet(
        viewerId,
        all.map((c) => c.id),
      ),
    ]);

    return {
      total,
      items: roots.map((root) => ({
        ...this.shape(root, authors, liked),
        replies: (byParent.get(root.id) ?? []).map((r) =>
          this.shape(r, authors, liked),
        ),
      })),
    };
  }

  /** The rest of one comment's replies, oldest first. */
  async listReplies(
    videoId: string,
    parentId: string,
    viewerId: string | null,
    q: VideoCommentsQueryDto,
  ) {
    const limit = q.limit ?? DEFAULT_LIMIT;
    const offset = q.offset ?? 0;

    const [rows, total] = await this.comments.findAndCount({
      where: { videoId, parentId },
      order: { createdAt: 'ASC' },
      take: limit,
      skip: offset,
    });

    const [authors, liked] = await Promise.all([
      this.authorMap(rows.map((c) => c.authorId)),
      this.likedSet(
        viewerId,
        rows.map((c) => c.id),
      ),
    ]);

    return { total, items: rows.map((c) => this.shape(c, authors, liked)) };
  }

  /**
   * Leave a comment, or reply to one.
   *
   * The comment and both counters move in one transaction: a thread showing
   * "12 comments" over eleven of them is the kind of drift nobody can explain
   * afterwards.
   */
  async create(videoId: string, authorId: string, dto: CreateVideoCommentDto) {
    await this.mustExist(videoId);

    if (dto.parentId) {
      const parent = await this.comments.findOneBy({ id: dto.parentId });
      if (!parent || parent.videoId !== videoId) {
        throw new NotFoundException('Comment not found');
      }
      // One level deep, like Instagram: a ladder of replies is unreadable on
      // a phone, so the depth is refused rather than rendered.
      if (parent.parentId) {
        throw new BadRequestException({
          code: 'REPLY_TOO_DEEP',
          message: 'You can only reply to a top-level comment',
        });
      }
    }

    const saved = await this.ds.transaction(async (manager) => {
      const comment = await manager.save(
        manager.create(VideoComment, {
          videoId,
          authorId,
          parentId: dto.parentId ?? null,
          body: dto.body,
        }),
      );

      await manager.increment(Video, { id: videoId }, 'commentCount', 1);
      if (dto.parentId) {
        await manager.increment(
          VideoComment,
          { id: dto.parentId },
          'replyCount',
          1,
        );
      }
      return comment;
    });

    const authors = await this.authorMap([authorId]);
    return this.shape(saved, authors, new Set());
  }

  /**
   * Delete a comment: the author of it, the author of the video, or an admin.
   *
   * A top-level comment takes its replies with it — the database cascade does
   * the deleting, and the counters are corrected by counting what went.
   */
  async remove(
    videoId: string,
    commentId: string,
    actorId: string,
    role: UserRole,
  ) {
    const comment = await this.comments.findOneBy({ id: commentId, videoId });
    if (!comment) throw new NotFoundException('Comment not found');

    const video = await this.videos.findOne({
      where: { id: videoId },
      select: { id: true, authorId: true },
    });

    const allowed =
      comment.authorId === actorId ||
      video?.authorId === actorId ||
      role === UserRole.ADMIN;
    if (!allowed) {
      throw new ForbiddenException({
        code: 'NOT_YOUR_COMMENT',
        message: 'This is not your comment',
      });
    }

    await this.ds.transaction(async (manager) => {
      const replies = comment.parentId
        ? 0
        : await manager.count(VideoComment, { where: { parentId: commentId } });

      await manager.delete(VideoComment, { id: commentId });
      await manager.decrement(
        Video,
        { id: videoId },
        'commentCount',
        1 + replies,
      );
      if (comment.parentId) {
        await manager.decrement(
          VideoComment,
          { id: comment.parentId },
          'replyCount',
          1,
        );
      }
    });

    return { success: true };
  }

  /** Both directions idempotent, so a double tap cannot error or double-count. */
  async setLike(
    videoId: string,
    commentId: string,
    userId: string,
    liked: boolean,
  ) {
    const comment = await this.comments.findOneBy({ id: commentId, videoId });
    if (!comment) throw new NotFoundException('Comment not found');

    const sql = liked
      ? `WITH ins AS (
           INSERT INTO video_comment_likes (comment_id, user_id) VALUES ($1, $2)
           ON CONFLICT (comment_id, user_id) DO NOTHING
           RETURNING 1
         )
         UPDATE video_comments
            SET like_count = like_count + (SELECT count(*) FROM ins)
          WHERE id = $1
         RETURNING like_count`
      : `WITH del AS (
           DELETE FROM video_comment_likes
            WHERE comment_id = $1 AND user_id = $2
           RETURNING 1
         )
         UPDATE video_comments
            SET like_count = GREATEST(like_count - (SELECT count(*) FROM del), 0)
          WHERE id = $1
         RETURNING like_count`;

    const [rows]: [{ like_count: number }[], number] =
      await this.comments.query(sql, [commentId, userId]);

    return { liked, likeCount: rows[0]?.like_count ?? 0 };
  }

  // ---- Internals -------------------------------------------------------

  private async mustExist(videoId: string): Promise<void> {
    const exists = await this.videos.existsBy({
      id: videoId,
      status: VideoStatus.READY,
    });
    if (!exists) throw new NotFoundException('Video not found');
  }

  private shape(
    comment: VideoComment,
    authors: Map<string, VideoCommentAuthor>,
    liked: Set<string>,
  ) {
    return {
      id: comment.id,
      videoId: comment.videoId,
      parentId: comment.parentId,
      authorId: comment.authorId,
      body: comment.body,
      likeCount: comment.likeCount,
      replyCount: comment.replyCount,
      likedByMe: liked.has(comment.id),
      createdAt: comment.createdAt.toISOString(),
      updatedAt: comment.updatedAt.toISOString(),
      // Null when the account has since been deleted; the comment stays, so
      // a thread does not develop holes where the replies no longer line up.
      author: authors.get(comment.authorId) ?? null,
    };
  }

  private async authorMap(
    ids: string[],
  ): Promise<Map<string, VideoCommentAuthor>> {
    const unique = [...new Set(ids)];
    if (!unique.length) return new Map();

    const rows = await this.users.find({
      where: { id: In(unique) },
      select: { id: true, name: true, surname: true, avatarThumbUrl: true },
    });

    return new Map(
      rows.map((u) => [
        u.id,
        {
          id: u.id,
          name: u.name,
          surname: u.surname,
          avatarThumbUrl: u.avatarThumbUrl,
        },
      ]),
    );
  }

  private async likedSet(
    viewerId: string | null,
    commentIds: string[],
  ): Promise<Set<string>> {
    if (!viewerId || !commentIds.length) return new Set();

    const rows = await this.likes.find({
      where: { userId: viewerId, commentId: In(commentIds) },
      select: { commentId: true },
    });
    return new Set(rows.map((r) => r.commentId));
  }
}
