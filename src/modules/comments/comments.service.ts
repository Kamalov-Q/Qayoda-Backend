import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Repository } from 'typeorm';
import { ListingComment, ListingCommentLike } from './comment.entity';
import { Listing } from '../listings/entities/listing.entity';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../../shared/enums';
import {
  CommentsQueryDto,
  CreateCommentDto,
  UpdateCommentDto,
} from './dto/comment.dto';

const DEFAULT_LIMIT = 20;

/** How many replies ride along with each top-level comment. Enough to show
 *  the exchange; the rest come from the replies endpoint on demand. */
const REPLY_PREVIEW = 2;

export interface CommentAuthor {
  id: string;
  name: string | null;
  surname: string | null;
  avatarThumbUrl: string | null;
}

@Injectable()
export class CommentsService {
  constructor(
    @InjectRepository(ListingComment)
    private readonly comments: Repository<ListingComment>,
    @InjectRepository(ListingCommentLike)
    private readonly likes: Repository<ListingCommentLike>,
    @InjectRepository(Listing) private readonly listings: Repository<Listing>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly ds: DataSource,
  ) {}

  /**
   * One page of the thread: top-level comments newest first, each with its
   * first couple of replies already attached.
   *
   * Newest first because the composer is at the bottom of the screen and a
   * new comment has to be visible the moment it is sent — at the end of a
   * chronological list it would land off-screen, which reads as a failure to
   * post. Replies stay oldest-first inside their comment, because an exchange
   * only makes sense read forward.
   */
  async list(listingId: string, viewerId: string | null, q: CommentsQueryDto) {
    await this.mustExistListing(listingId);

    const limit = q.limit ?? DEFAULT_LIMIT;
    const offset = q.offset ?? 0;

    const [roots, total] = await this.comments.findAndCount({
      where: { listingId, parentId: IsNull() },
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });

    // Replies for the whole page in one read, then cut to the preview size
    // per parent — a query per comment is what makes threads slow.
    const rootIds = roots.map((r) => r.id);
    const replies = rootIds.length
      ? await this.comments.find({
          where: { parentId: In(rootIds) },
          order: { createdAt: 'ASC' },
        })
      : [];

    const byParent = new Map<string, ListingComment[]>();
    for (const reply of replies) {
      const list = byParent.get(reply.parentId!) ?? [];
      if (list.length < REPLY_PREVIEW) list.push(reply);
      byParent.set(reply.parentId!, list);
    }

    const all = [...roots, ...replies];
    const [authors, liked] = await Promise.all([
      this.authorMap(all.map((c) => c.authorId)),
      this.likedSet(viewerId, all.map((c) => c.id)),
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
    listingId: string,
    parentId: string,
    viewerId: string | null,
    q: CommentsQueryDto,
  ) {
    const limit = q.limit ?? DEFAULT_LIMIT;
    const offset = q.offset ?? 0;

    const [rows, total] = await this.comments.findAndCount({
      where: { listingId, parentId },
      order: { createdAt: 'ASC' },
      take: limit,
      skip: offset,
    });

    const [authors, liked] = await Promise.all([
      this.authorMap(rows.map((c) => c.authorId)),
      this.likedSet(viewerId, rows.map((c) => c.id)),
    ]);

    return { total, items: rows.map((c) => this.shape(c, authors, liked)) };
  }

  async create(listingId: string, authorId: string, dto: CreateCommentDto) {
    await this.mustExistListing(listingId);

    if (dto.parentId) {
      const parent = await this.comments.findOneBy({ id: dto.parentId });
      if (!parent || parent.listingId !== listingId) {
        throw new NotFoundException('Comment not found');
      }
      // One level deep: a reply to a reply is re-pointed at nothing, it is
      // refused, so the client cannot quietly build a ladder nobody can read.
      if (parent.parentId) {
        throw new BadRequestException({
          code: 'REPLY_TOO_DEEP',
          message: 'Replies cannot be replied to',
        });
      }
    }

    const saved = await this.ds.transaction(async (m) => {
      const comment = await m.save(
        m.create(ListingComment, {
          listingId,
          authorId,
          parentId: dto.parentId ?? null,
          body: dto.body,
        }),
      );
      if (dto.parentId) {
        await m.increment(ListingComment, { id: dto.parentId }, 'replyCount', 1);
      }
      return comment;
    });

    const authors = await this.authorMap([authorId]);
    return this.shape(saved, authors, new Set());
  }

  /** Authors edit their own words, and nobody else's. */
  async update(
    listingId: string,
    commentId: string,
    userId: string,
    dto: UpdateCommentDto,
  ) {
    const comment = await this.mustExist(listingId, commentId);
    if (comment.authorId !== userId) {
      throw new ForbiddenException({
        code: 'NOT_YOUR_COMMENT',
        message: 'You can only edit your own comment',
      });
    }

    await this.comments.update(commentId, {
      body: dto.body,
      updatedAt: new Date(),
    });

    const authors = await this.authorMap([comment.authorId]);
    const liked = await this.likedSet(userId, [commentId]);
    return this.shape(
      { ...comment, body: dto.body, updatedAt: new Date() },
      authors,
      liked,
    );
  }

  /**
   * Removal, by the author or by whoever owns the listing. The owner is
   * included on purpose: it is their advert the thread hangs under, and the
   * alternative is waiting on a moderator for every insult under a photo of
   * their house.
   */
  async remove(
    listingId: string,
    commentId: string,
    userId: string,
    role: UserRole,
  ) {
    const comment = await this.mustExist(listingId, commentId);
    const listing = await this.mustExistListing(listingId);

    const allowed =
      comment.authorId === userId ||
      listing.ownerId === userId ||
      role === UserRole.ADMIN;

    if (!allowed) {
      throw new ForbiddenException({
        code: 'NOT_YOUR_COMMENT',
        message: 'You cannot delete this comment',
      });
    }

    await this.deleteWithReplies(comment);
    return { success: true };
  }

  /** Moderator removal from the dashboard — any comment, no ownership test. */
  async adminRemove(commentId: string) {
    const comment = await this.comments.findOneBy({ id: commentId });
    if (!comment) throw new NotFoundException('Comment not found');

    await this.deleteWithReplies(comment);
    return { success: true };
  }

  /**
   * Both directions of the heart, idempotent like the save toggle: liking
   * twice is one like, unliking what you never liked is a success. A repeated
   * tap on a slow connection must not become an error.
   */
  async setLike(
    listingId: string,
    commentId: string,
    userId: string,
    liked: boolean,
  ) {
    await this.mustExist(listingId, commentId);

    const changed = await this.ds.transaction(async (m) => {
      if (liked) {
        const { identifiers } = await m
          .createQueryBuilder()
          .insert()
          .into(ListingCommentLike)
          .values({ commentId, userId })
          .orIgnore()
          .execute();
        // orIgnore returns no identifier when the row was already there.
        return identifiers.length > 0 && !!identifiers[0];
      }
      const { affected } = await m.delete(ListingCommentLike, {
        commentId,
        userId,
      });
      return !!affected;
    });

    if (changed) {
      // Recounted rather than incremented: the count is the thing people see,
      // and a drifted counter is worse than one query.
      await this.comments.query(
        `UPDATE listing_comments c
            SET like_count = (SELECT COUNT(*) FROM listing_comment_likes
                               WHERE comment_id = $1)
          WHERE c.id = $1`,
        [commentId],
      );
    }

    const fresh = await this.comments.findOneByOrFail({ id: commentId });
    return { liked, likeCount: fresh.likeCount };
  }

  /** The dashboard's table: every comment, newest first, hydrated. */
  async adminList(q: CommentsQueryDto) {
    const limit = q.limit ?? DEFAULT_LIMIT;
    const offset = q.offset ?? 0;

    const [rows, total] = await this.comments.findAndCount({
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });

    const listings = rows.length
      ? await this.listings.find({
          where: { id: In([...new Set(rows.map((r) => r.listingId))]) },
          select: { id: true, title: true },
        })
      : [];
    const titles = new Map(listings.map((l) => [l.id, l.title]));
    const authors = await this.authorMap(rows.map((r) => r.authorId));

    return {
      total,
      items: rows.map((c) => ({
        ...this.shape(c, authors, new Set()),
        listingId: c.listingId,
        listingTitle: titles.get(c.listingId) ?? null,
        isReply: !!c.parentId,
      })),
    };
  }

  /** A comment and everything hanging off it, in one transaction. */
  private async deleteWithReplies(comment: ListingComment) {
    await this.ds.transaction(async (m) => {
      const replyIds = comment.parentId
        ? []
        : (
            await m.find(ListingComment, {
              where: { parentId: comment.id },
              select: { id: true },
            })
          ).map((r) => r.id);

      const ids = [comment.id, ...replyIds];
      // Likes first: they reference rows that are about to stop existing, and
      // nothing else will ever clean them up.
      await m.delete(ListingCommentLike, { commentId: In(ids) });
      await m.delete(ListingComment, { id: In(ids) });

      // A deleted reply leaves its parent's counter one too high.
      if (comment.parentId) {
        await m.decrement(
          ListingComment,
          { id: comment.parentId },
          'replyCount',
          1,
        );
      }
    });
  }

  private async mustExist(listingId: string, commentId: string) {
    const comment = await this.comments.findOneBy({ id: commentId });
    if (!comment || comment.listingId !== listingId) {
      throw new NotFoundException('Comment not found');
    }
    return comment;
  }

  private async mustExistListing(listingId: string) {
    const listing = await this.listings.findOne({
      where: { id: listingId },
      select: { id: true, ownerId: true },
    });
    if (!listing) throw new NotFoundException('Listing not found');
    return listing;
  }

  /** Which of these comments the viewer has already hearted. */
  private async likedSet(viewerId: string | null, commentIds: string[]) {
    if (!viewerId || !commentIds.length) return new Set<string>();

    const rows = await this.likes.find({
      where: { userId: viewerId, commentId: In(commentIds) },
      select: { commentId: true },
    });
    return new Set(rows.map((r) => r.commentId));
  }

  private async authorMap(ids: string[]) {
    const unique = [...new Set(ids)];
    if (!unique.length) return new Map<string, CommentAuthor>();

    const users = await this.users.find({
      where: { id: In(unique) },
      select: { id: true, name: true, surname: true, avatarThumbUrl: true },
    });

    return new Map<string, CommentAuthor>(
      users.map((u) => [
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

  /** The wire shape. `author` is null for a deleted account — the comment
   *  outlives it, the same way a listing does. */
  private shape(
    comment: ListingComment,
    authors: Map<string, CommentAuthor>,
    liked: Set<string>,
  ) {
    return {
      id: comment.id,
      listingId: comment.listingId,
      parentId: comment.parentId,
      authorId: comment.authorId,
      body: comment.body,
      likeCount: comment.likeCount,
      replyCount: comment.replyCount,
      likedByMe: liked.has(comment.id),
      createdAt: comment.createdAt,
      updatedAt: comment.updatedAt,
      author: authors.get(comment.authorId) ?? null,
    };
  }
}
