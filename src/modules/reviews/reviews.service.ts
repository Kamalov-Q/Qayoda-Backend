import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThanOrEqual, Not, IsNull, Repository } from 'typeorm';
import { ListingReview } from './review.entity';
import { Listing } from '../listings/entities/listing.entity';
import { User } from '../users/entities/user.entity';
import {
  AdminReviewsQueryDto,
  ReviewsQueryDto,
  UpsertReviewDto,
} from './dto/review.dto';

const DEFAULT_LIMIT = 20;

/** The five buckets, always all five: a histogram missing its empty rows
 *  draws wrong, and the client should not have to fill the gaps. */
type Distribution = Record<1 | 2 | 3 | 4 | 5, number>;

const emptyDistribution = (): Distribution => ({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });

@Injectable()
export class ReviewsService {
  constructor(
    @InjectRepository(ListingReview)
    private readonly reviews: Repository<ListingReview>,
    @InjectRepository(Listing) private readonly listings: Repository<Listing>,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  /**
   * The reviews section: one page of reviews, the histogram behind the
   * average, and — when the caller is signed in — their own review, so the
   * screen can open on "edit yours" instead of offering a second one.
   *
   * Public: `viewerId` is null for guests, and everything but `mine` is the
   * same for them.
   */
  async list(listingId: string, viewerId: string | null, q: ReviewsQueryDto) {
    await this.mustExist(listingId);

    const limit = q.limit ?? DEFAULT_LIMIT;
    const offset = q.offset ?? 0;

    const [summary, rows, mine] = await Promise.all([
      this.summaryOf(listingId),
      this.reviews.find({
        where: { listingId },
        // Newest first, like every other list in the app. "Most helpful"
        // needs votes on reviews, which is a feature away.
        order: { createdAt: 'DESC' },
        take: limit,
        skip: offset,
      }),
      viewerId
        ? this.reviews.findOneBy({ listingId, authorId: viewerId })
        : null,
    ]);

    // The caller's own review is pinned to the top of page one rather than
    // left where its date puts it — it is the one row they came to look for.
    // Page one only: pinning it to every page would make it reappear as the
    // reader scrolls.
    const items =
      mine && offset === 0
        ? [mine, ...rows.filter((r) => r.id !== mine.id)]
        : rows;

    return {
      ...summary,
      mine: mine ? this.shape(mine, null) : null,
      items: await this.withAuthors(items),
    };
  }

  /**
   * Create the caller's review, or replace it if they already left one.
   *
   * Idempotent on purpose (same shape as PUT /listings/:id/save): "review"
   * and "edit my review" are one action from the reader's side, and a 409 on
   * the second tap would only ever be something the client has to translate
   * back into an edit.
   */
  async upsert(listingId: string, authorId: string, dto: UpsertReviewDto) {
    const listing = await this.mustExist(listingId);

    // Rating your own listing is free advertising, not a review.
    if (listing.ownerId === authorId) {
      throw new ForbiddenException({
        code: 'OWN_LISTING',
        message: 'You cannot review your own listing',
      });
    }

    const comment = dto.comment?.trim() || null;

    // ON CONFLICT rather than find-then-write: two taps in flight would
    // otherwise race past an existsBy and hit the unique constraint.
    await this.reviews.upsert(
      {
        listingId,
        authorId,
        rating: dto.rating,
        comment,
        // Set explicitly: @UpdateDateColumn only fires on a save(), and an
        // edited review that still reads as written last March is a lie.
        updatedAt: new Date(),
      },
      { conflictPaths: ['listingId', 'authorId'] },
    );

    await this.recount(listingId);

    const saved = await this.reviews.findOneByOrFail({ listingId, authorId });
    return this.shape(saved, null);
  }

  /** Withdraw the caller's own review. Idempotent: gone is gone. */
  async remove(listingId: string, authorId: string) {
    const { affected } = await this.reviews.delete({ listingId, authorId });
    if (affected) await this.recount(listingId);
    return { success: true };
  }

  /**
   * "Your activity": the reviews this person has written, newest first, each
   * with enough of its listing to tap back into.
   */
  async myReviews(userId: string, q: ReviewsQueryDto) {
    const limit = q.limit ?? DEFAULT_LIMIT;
    const offset = q.offset ?? 0;

    const [rows, total] = await this.reviews.findAndCount({
      where: { authorId: userId },
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });

    const listings = rows.length
      ? await this.listings.find({
          where: { id: In([...new Set(rows.map((r) => r.listingId))]) },
          select: { id: true, title: true },
          relations: { images: true },
        })
      : [];

    const cards = new Map(
      listings.map((l) => {
        const cover =
          l.images?.find((i) => i.isPrimary) ?? l.images?.[0] ?? null;
        return [
          l.id,
          {
            id: l.id,
            title: l.title,
            thumbUrl: cover?.thumbUrl ?? cover?.url ?? null,
          },
        ];
      }),
    );

    return {
      total,
      items: rows.map((r) => ({
        ...this.shape(r, null),
        listing: cards.get(r.listingId) ?? null,
      })),
    };
  }

  /**
   * The dashboard's table. Hydrated with the listing and the author in two
   * keyed reads — the same shape as the reports queue, and for the same
   * reason: joins do not survive take/skip cleanly.
   */
  async adminList(q: AdminReviewsQueryDto) {
    const limit = q.limit ?? DEFAULT_LIMIT;
    const offset = q.offset ?? 0;

    const where = {
      ...(q.maxRating ? { rating: LessThanOrEqual(q.maxRating) } : {}),
      ...(q.withText ? { comment: Not(IsNull()) } : {}),
    };

    const [rows, total] = await this.reviews.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });

    const listings = rows.length
      ? await this.listings.find({
          where: { id: In([...new Set(rows.map((r) => r.listingId))]) },
          select: { id: true, title: true, ownerId: true },
        })
      : [];
    const titles = new Map(listings.map((l) => [l.id, l.title]));

    const authors = await this.authorMap(rows.map((r) => r.authorId));

    return {
      total,
      items: rows.map((r) => ({
        ...this.shape(r, authors.get(r.authorId) ?? null),
        listingId: r.listingId,
        listingTitle: titles.get(r.listingId) ?? null,
      })),
    };
  }

  /** Moderator removal — for reviews that are abuse rather than opinion. */
  async adminRemove(id: string) {
    const review = await this.reviews.findOneBy({ id });
    if (!review) throw new NotFoundException('Review not found');

    await this.reviews.delete(id);
    await this.recount(review.listingId);
    return { success: true };
  }

  /** Average, count and the five-bucket histogram, in one pass. */
  private async summaryOf(listingId: string) {
    const rows = await this.reviews
      .createQueryBuilder('r')
      .select('r.rating', 'rating')
      .addSelect('COUNT(*)', 'count')
      .where('r.listing_id = :listingId', { listingId })
      .groupBy('r.rating')
      .getRawMany<{ rating: number; count: string }>();

    const distribution = emptyDistribution();
    let count = 0;
    let sum = 0;

    for (const row of rows) {
      const n = Number(row.count);
      const stars = Number(row.rating) as 1 | 2 | 3 | 4 | 5;
      distribution[stars] = n;
      count += n;
      sum += stars * n;
    }

    return {
      count,
      // Null, not 0: "no reviews yet" and "rated zero stars" are different
      // things, and only one of them is possible.
      average: count ? Math.round((sum / count) * 10) / 10 : null,
      distribution,
    };
  }

  /**
   * Push the aggregate onto the listing row. Recomputed from the reviews
   * rather than incremented: an edit changes the sum by an amount nobody
   * tracked, and a recount of one listing's reviews is an index lookup.
   */
  private async recount(listingId: string) {
    await this.listings.query(
      `UPDATE listings l
          SET rating_avg = s.avg, rating_count = s.cnt
         FROM (SELECT AVG(rating) AS avg, COUNT(*) AS cnt
                 FROM listing_reviews WHERE listing_id = $1) s
        WHERE l.id = $1`,
      [listingId],
    );
  }

  private async mustExist(listingId: string) {
    const listing = await this.listings.findOne({
      where: { id: listingId },
      select: { id: true, ownerId: true },
    });
    if (!listing) throw new NotFoundException('Listing not found');
    return listing;
  }

  /** Reviews with their authors attached, in one keyed read. */
  private async withAuthors(rows: ListingReview[]) {
    const authors = await this.authorMap(rows.map((r) => r.authorId));
    return rows.map((r) => this.shape(r, authors.get(r.authorId) ?? null));
  }

  private async authorMap(ids: string[]) {
    const unique = [...new Set(ids)];
    if (!unique.length) return new Map<string, Author>();

    const users = await this.users.find({
      where: { id: In(unique) },
      select: { id: true, name: true, surname: true, avatarThumbUrl: true },
    });

    return new Map<string, Author>(
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

  /** The wire shape. `author` is null for a deleted account — the review
   *  outlives it, the same way a listing does. */
  private shape(review: ListingReview, author: Author | null) {
    return {
      id: review.id,
      authorId: review.authorId,
      rating: review.rating,
      comment: review.comment,
      createdAt: review.createdAt,
      updatedAt: review.updatedAt,
      author,
    };
  }
}

export interface Author {
  id: string;
  name: string | null;
  surname: string | null;
  avatarThumbUrl: string | null;
}
