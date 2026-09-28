import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  DECAY_FLOOR,
  HALF_LIFE_DAYS,
  MAX_RATING,
  MIN_RATING,
  PRIOR,
  PRIOR_WEIGHT,
  REPORT_LISTING_WEIGHT,
  REPORT_OWNER_CAP,
  REPORT_OWNER_WEIGHT,
  REPORT_STARS,
} from './rating.constants';

/** One side of the sum: how loud a voice is, and what it said. */
interface Vote {
  weight: number;
  stars: number;
}

/** A listing's stored rating. `count` is REVIEWS only — see `score`. */
export interface Rating {
  ratingAvg: number;
  ratingCount: number;
}

/**
 * Age decay, as SQL. Half the say per HALF_LIFE_DAYS, never below the floor.
 * Written once here so reviews and reports fade at exactly the same rate.
 */
const DECAY = `GREATEST(
  ${DECAY_FLOOR},
  POWER(0.5, EXTRACT(EPOCH FROM (now() - %COL%)) / 86400.0 / ${HALF_LIFE_DAYS})
)`;
const decayOf = (column: string) => DECAY.replace('%COL%', column);

@Injectable()
export class RatingService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * The one place a rating is decided.
   *
   * Everything that bears on a listing is a weighted vote on a five-star
   * scale, and the answer is their weighted mean against a five-star prior:
   *
   *     rating = (Σ wᵢ·starsᵢ + PRIOR_WEIGHT·PRIOR) / (Σ wᵢ + PRIOR_WEIGHT)
   *
   * Three kinds of voice:
   *
   * - a review, worth its stars, fading with age;
   * - an upheld report on this listing, worth one star and three reviews;
   * - an upheld report against its seller — on their other listings or in
   *   chat — worth one star and one review, capped.
   *
   * Nothing here is a subtraction. A penalty that subtracts from a finished
   * average lets a listing with two reviews and a listing with two hundred
   * take the same hit from the same report, which is not what either of them
   * means. Weighted votes get this right for free: the more a listing is
   * known, the less any one voice moves it.
   */
  private static score(votes: Vote[]): number {
    let weighted = PRIOR * PRIOR_WEIGHT;
    let weight = PRIOR_WEIGHT;

    for (const v of votes) {
      weighted += v.weight * v.stars;
      weight += v.weight;
    }

    const raw = weighted / weight;
    const clamped = Math.min(MAX_RATING, Math.max(MIN_RATING, raw));
    // One decimal, the way every store shows it. Rounded once, here, so the
    // card, the reviews page and the admin table cannot disagree.
    return Math.round(clamped * 10) / 10;
  }

  /** Recompute these listings and write the result. Safe to call with none. */
  async recomputeListings(listingIds: string[]): Promise<void> {
    const ids = [...new Set(listingIds)].filter(Boolean);
    if (!ids.length) return;

    const owners = await this.dataSource.query<
      { id: string; owner_id: string }[]
    >(`SELECT id, owner_id FROM listings WHERE id = ANY($1::uuid[])`, [ids]);
    if (!owners.length) return;

    const ownerIds = [...new Set(owners.map((o) => o.owner_id))];

    const [reviews, listingReports, ownerReports] = await Promise.all([
      this.reviewWeights(ids),
      this.listingReportWeights(ids),
      this.ownerReportWeights(ownerIds),
    ]);

    const rows = owners.map(({ id, owner_id }) => {
      const review = reviews.get(id);
      const votes: Vote[] = [];

      // Reviews arrive pre-summed: their weighted total behaves in the mean
      // exactly as the individual votes would.
      if (review?.weight) {
        votes.push({ weight: review.weight, stars: review.weighted / review.weight });
      }

      const onListing = listingReports.get(id) ?? 0;
      if (onListing) {
        votes.push({
          weight: onListing * REPORT_LISTING_WEIGHT,
          stars: REPORT_STARS,
        });
      }

      // The seller's own record, minus whatever was already counted against
      // THIS listing — a report should not be charged twice to the advert it
      // was actually about.
      const onOwner = Math.max(0, (ownerReports.get(owner_id) ?? 0) - onListing);
      if (onOwner) {
        votes.push({
          weight: Math.min(onOwner * REPORT_OWNER_WEIGHT, REPORT_OWNER_CAP),
          stars: REPORT_STARS,
        });
      }

      return {
        id,
        avg: RatingService.score(votes),
        count: review?.count ?? 0,
      };
    });

    await this.dataSource.query(
      `UPDATE listings l
          SET rating_avg = v.avg, rating_count = v.count
         FROM (SELECT * FROM unnest($1::uuid[], $2::real[], $3::int[])
                 AS t(id, avg, count)) v
        WHERE l.id = v.id`,
      [
        rows.map((r) => r.id),
        rows.map((r) => r.avg),
        rows.map((r) => r.count),
      ],
    );
  }

  /** One listing — the common case, after a review lands. */
  recomputeListing(listingId: string): Promise<void> {
    return this.recomputeListings([listingId]);
  }

  /**
   * Everything this seller has posted.
   *
   * Called when their record changes rather than when one advert does: an
   * upheld chat report, or a report on listing A, moves the rating of B and C
   * as well. There is no event that touches only "the seller's rating" —
   * their rating IS the state of their listings.
   */
  async recomputeOwner(ownerId: string): Promise<void> {
    const rows = await this.dataSource.query<{ id: string }[]>(
      `SELECT id FROM listings WHERE owner_id = $1`,
      [ownerId],
    );
    await this.recomputeListings(rows.map((r) => r.id));
  }

  /**
   * A seller's own rating, for their profile.
   *
   * The same formula over everything at once — every review anyone left on
   * any of their listings, plus every upheld report against them — rather
   * than an average of their listings' averages. Otherwise a seller could
   * dilute one terrible advert by posting nine empty ones, each of which
   * starts at five.
   */
  async ownerRating(ownerId: string): Promise<Rating> {
    const [reviews, reports] = await Promise.all([
      this.dataSource.query<{ weighted: string; weight: string; count: string }[]>(
        `SELECT COALESCE(SUM(${decayOf('r.created_at')} * r.rating), 0) AS weighted,
                COALESCE(SUM(${decayOf('r.created_at')}), 0)            AS weight,
                COUNT(*)                                                AS count
           FROM listing_reviews r
           JOIN listings l ON l.id = r.listing_id
          WHERE l.owner_id = $1`,
        [ownerId],
      ),
      this.ownerReportWeights([ownerId]),
    ]);

    const row = reviews[0];
    const weight = Number(row?.weight ?? 0);
    const votes: Vote[] = [];
    if (weight) {
      votes.push({ weight, stars: Number(row.weighted) / weight });
    }

    const upheld = reports.get(ownerId) ?? 0;
    if (upheld) {
      // The seller's own page shows the seller's own weight — no cap here,
      // because there is no individual listing left to be unfair to.
      votes.push({ weight: upheld * REPORT_OWNER_WEIGHT, stars: REPORT_STARS });
    }

    return {
      ratingAvg: RatingService.score(votes),
      ratingCount: Number(row?.count ?? 0),
    };
  }

  // ------------------------------------------------------------- aggregates

  /** Decayed review totals per listing. */
  private async reviewWeights(listingIds: string[]) {
    const rows = await this.dataSource.query<
      { listing_id: string; weighted: string; weight: string; count: string }[]
    >(
      `SELECT listing_id,
              SUM(${decayOf('created_at')} * rating) AS weighted,
              SUM(${decayOf('created_at')})          AS weight,
              COUNT(*)                                AS count
         FROM listing_reviews
        WHERE listing_id = ANY($1::uuid[])
        GROUP BY listing_id`,
      [listingIds],
    );

    return new Map(
      rows.map((r) => [
        r.listing_id,
        {
          weighted: Number(r.weighted),
          weight: Number(r.weight),
          count: Number(r.count),
        },
      ]),
    );
  }

  /**
   * Upheld reports per listing, decayed.
   *
   * RESOLVED only. An OPEN report is an accusation nobody has checked, and
   * counting those would hand every user a button that lowers a rival's
   * rating — the one thing a rating system must never have. DISMISSED means a
   * moderator looked and disagreed, so it leaves no mark at all.
   */
  private async listingReportWeights(listingIds: string[]) {
    const rows = await this.dataSource.query<
      { listing_id: string; weight: string }[]
    >(
      `SELECT listing_id, SUM(${decayOf('created_at')}) AS weight
         FROM listing_reports
        WHERE status = 'RESOLVED' AND listing_id = ANY($1::uuid[])
        GROUP BY listing_id`,
      [listingIds],
    );

    return new Map(rows.map((r) => [r.listing_id, Number(r.weight)]));
  }

  /**
   * Upheld reports against each seller, decayed: reports on any listing they
   * own, plus chat reports filed by the other side of a conversation.
   *
   * A chat report names a conversation, not a person, so the accused is
   * whichever participant did not file it.
   */
  private async ownerReportWeights(ownerIds: string[]) {
    const rows = await this.dataSource.query<
      { owner_id: string; weight: string }[]
    >(
      `SELECT owner_id, SUM(weight) AS weight FROM (
         SELECT l.owner_id, ${decayOf('rep.created_at')} AS weight
           FROM listing_reports rep
           JOIN listings l ON l.id = rep.listing_id
          WHERE rep.status = 'RESOLVED' AND l.owner_id = ANY($1::uuid[])

         UNION ALL

         SELECT CASE WHEN c.host_id = cr.reporter_id THEN c.guest_id
                     ELSE c.host_id END AS owner_id,
                ${decayOf('cr.created_at')} AS weight
           FROM chat_reports cr
           JOIN conversations c ON c.id = cr.conversation_id
          WHERE cr.status = 'RESOLVED'
            AND CASE WHEN c.host_id = cr.reporter_id THEN c.guest_id
                     ELSE c.host_id END = ANY($1::uuid[])
       ) all_reports
       GROUP BY owner_id`,
      [ownerIds],
    );

    return new Map(rows.map((r) => [r.owner_id, Number(r.weight)]));
  }
}
