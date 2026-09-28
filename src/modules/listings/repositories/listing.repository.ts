import { Injectable } from '@nestjs/common';
import { In, DataSource, Repository } from 'typeorm';
import { Listing } from '../entities/listing.entity';
import { ListingStatus } from '../enums/listing-status.enum';

/** How a profile's listings can be ordered. */
export type OwnerListingSort = 'newest' | 'oldest' | 'priceAsc' | 'priceDesc';

@Injectable()
export class ListingRepository extends Repository<Listing> {
  constructor(private readonly dataSource: DataSource) {
    super(Listing, dataSource.createEntityManager());
  }

  findWithRelations(id: string) {
    return this.findOne({
      where: { id },
      relations: { offers: true, images: true },
    });
  }

  findMine(ownerId: string, limit?: number, offset?: number) {
    return this.find({
      where: { ownerId },
      relations: { offers: true, images: true },
      order: { createdAt: 'DESC' },
      ...(limit ? { take: limit, skip: offset ?? 0 } : {}),
    });
  }

  /**
   * The browsable feed: every ACTIVE listing, filtered and paged. Search goes
   * through title and address — the two fields people actually type.
   */
  async findFeed(q: {
    purpose: string;
    category?: string;
    priceMin?: number;
    priceMax?: number;
    search?: string;
    /** Address only, unlike `search`, which also matches the title. */
    address?: string;
    /** All three together, or none — a centre without a radius means nothing. */
    centerLng?: number;
    centerLat?: number;
    radiusM?: number;
    sort: 'newest' | 'priceAsc' | 'priceDesc';
    limit: number;
    offset: number;
  }): Promise<Listing[]> {
    // Ids first, then a plain relation fetch — the same two-step findSimilar
    // and findPublicByOwner use, and for the same reason: a query that joins
    // the offers and images needs TypeORM's DISTINCT-ids wrapper to page, and
    // that wrapper cannot order by a column it does not select. The previous
    // fix for that (`addSelect` of the joined price) made every price-sorted
    // request answer 500, and once the alias was right it hydrated `offers`
    // from the ordering join — so every listing came back with its offers
    // duplicated and stripped to a single field.
    const ids = this.createQueryBuilder('l')
      .select('l.id', 'id')
      .where('l.status = :status', { status: ListingStatus.ACTIVE });

    // EXISTS rather than a join: the price bounds belong to the offer that
    // matches the purpose, and a join would also multiply the row by every
    // offer and image the listing has.
    const offerConditions = ['o.listing_id = l.id', 'o.is_active = true', 'o.purpose = :purpose'];
    if (q.priceMin !== undefined) offerConditions.push('o.price_usd >= :priceMin');
    if (q.priceMax !== undefined) offerConditions.push('o.price_usd <= :priceMax');
    ids.andWhere(
      `EXISTS (SELECT 1 FROM listing_offers o WHERE ${offerConditions.join(' AND ')})`,
      { purpose: q.purpose, priceMin: q.priceMin, priceMax: q.priceMax },
    );

    if (q.category) ids.andWhere('l.category = :category', { category: q.category });
    if (q.search) {
      ids.andWhere('(l.title ILIKE :search OR l.address ILIKE :search)', {
        search: `%${q.search.replace(/[\\%_]/g, '\\$&')}%`,
      });
    }
    // The funnel sheet's own address field. It used to reach the map and
    // nothing else, so switching to the list silently widened the search.
    if (q.address) {
      ids.andWhere('l.address ILIKE :address', {
        address: `%${q.address.replace(/[\\%_]/g, '\\$&')}%`,
      });
    }
    // Same rule as the map: a listing is in or out by its centroid, so the
    // circle drawn on the map and the list behind it agree.
    if (q.centerLng != null && q.centerLat != null && q.radiusM) {
      ids.andWhere(
        `ST_DWithin(
           l.centroid,
           ST_SetSRID(ST_MakePoint(:centerLng, :centerLat), 4326)::geography,
           :radiusM
         )`,
        { centerLng: q.centerLng, centerLat: q.centerLat, radiusM: q.radiusM },
      );
    }

    if (q.sort === 'newest') {
      ids.orderBy('l.published_at', 'DESC', 'NULLS LAST');
    } else {
      // The cheapest live offer of the purpose being browsed. A listing with
      // no comparable price sorts last either way — it is not cheap, its
      // price is unknown.
      ids
        .addSelect(
          `(SELECT MIN(o.price_usd) FROM listing_offers o
             WHERE o.listing_id = l.id AND o.is_active = true
               AND o.purpose = :purpose)`,
          'sort_price',
        )
        .orderBy('sort_price', q.sort === 'priceAsc' ? 'ASC' : 'DESC', 'NULLS LAST');
    }

    const rows = await ids
      // limit/offset, not take/skip: these are raw rows, so there is no
      // entity hydration for take/skip to protect.
      .limit(q.limit)
      .offset(q.offset)
      .getRawMany<{ id: string }>();

    return this.findManyInOrder(rows.map((r) => r.id));
  }

  /**
   * Listings with their offers and images, in the order the ids were given.
   * `find` returns them in whatever order Postgres liked, and the order is
   * the whole point of the query that produced the ids.
   */
  private async findManyInOrder(ids: string[]): Promise<Listing[]> {
    if (!ids.length) return [];

    const items = await this.find({
      where: { id: In(ids) },
      relations: { offers: true, images: true },
    });
    const byId = new Map(items.map((l) => [l.id, l]));

    return ids.map((id) => byId.get(id)).filter((l): l is Listing => !!l);
  }

  /**
   * "More like this" for the detail page: same category, nearest first when
   * the anchor has a location, freshest first when it somehow does not.
   *
   * Two steps on purpose: ids first (no joins → no TypeORM DISTINCT wrapper,
   * which chokes on a raw KNN ORDER BY on some Postgres setups — the prod-only
   * 500), then a plain relation fetch re-ordered to match.
   */
  async findSimilar(anchor: Listing, limit: number): Promise<Listing[]> {
    const idsQb = this.createQueryBuilder('l')
      .select('l.id', 'id')
      .where('l.status = :status', { status: ListingStatus.ACTIVE })
      .andWhere('l.id != :id', { id: anchor.id })
      .andWhere('l.category = :category', { category: anchor.category })
      .limit(limit);

    const coords = anchor.centroid?.coordinates;
    if (Array.isArray(coords) && coords.length === 2) {
      const [lng, lat] = coords;
      idsQb
        .orderBy(
          'l.centroid <-> ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography',
          'ASC',
        )
        .setParameters({ lng, lat });
    } else {
      idsQb.orderBy('l.publishedAt', 'DESC');
    }

    const rows = await idsQb.getRawMany<{ id: string }>();
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);

    const listings = await this.find({
      where: { id: In(ids) },
      relations: { offers: true, images: true },
    });
    // find() ignores the KNN order — restore it.
    const rank = new Map(ids.map((id, i) => [id, i]));
    return listings.sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  }

  /** The freshest ACTIVE listings, for the Home screen strip. */
  findLatest(limit: number) {
    return this.find({
      where: { status: ListingStatus.ACTIVE },
      relations: { offers: true, images: true },
      order: { publishedAt: 'DESC' },
      take: limit,
    });
  }

  /**
   * The cheapest live offer on a listing, in USD. Used to sort a profile by
   * price: a listing can carry both a sale and a rent offer, and the one a
   * reader means by "cheapest first" is the lowest of whichever are live.
   */
  private static readonly OWNER_PRICE = `(
    SELECT MIN(o.price_usd) FROM listing_offers o
     WHERE o.listing_id = l.id AND o.is_active = true
  )`;

  /**
   * One page of someone's live listings, filtered and sorted the way their
   * profile asks for. Paged because this feeds a profile screen on a phone:
   * an agency with 200 ads would otherwise ship all of them, with every offer
   * and image row, in a single response.
   *
   * Ids first, then a plain relation fetch — the same two-step `findSimilar`
   * uses. A single joined query would make TypeORM wrap everything in its
   * DISTINCT-ids subquery, which cannot order by an expression that subquery
   * does not select.
   */
  async findPublicByOwner(
    ownerId: string,
    q: {
      purpose?: string;
      category?: string;
      sort?: OwnerListingSort;
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<{ items: Listing[]; total: number }> {
    const limit = q.limit ?? 20;
    const offset = q.offset ?? 0;

    const base = this.createQueryBuilder('l')
      .where('l.ownerId = :ownerId', { ownerId })
      .andWhere('l.status = :status', { status: ListingStatus.ACTIVE });

    // EXISTS rather than a join: a listing with both a sale and a rent offer
    // must count once, and a join would duplicate its row into the page.
    if (q.purpose) {
      base.andWhere(
        `EXISTS (SELECT 1 FROM listing_offers o
                  WHERE o.listing_id = l.id AND o.is_active = true
                    AND o.purpose = :purpose)`,
        { purpose: q.purpose },
      );
    }
    if (q.category) base.andWhere('l.category = :category', { category: q.category });

    // The real total for THIS filter, so the profile can say how many the
    // reader is looking at rather than how many the seller has in all.
    const total = await base.getCount();
    if (offset >= total) return { items: [], total };

    const idsQb = base.clone().select('l.id', 'id');
    switch (q.sort) {
      case 'oldest':
        idsQb.orderBy('l.createdAt', 'ASC');
        break;
      case 'priceAsc':
      case 'priceDesc':
        idsQb
          .addSelect(ListingRepository.OWNER_PRICE, 'sort_price')
          // A listing whose offers carry no USD price sorts last either way —
          // it is not cheap, its price is unknown.
          .orderBy('sort_price', q.sort === 'priceAsc' ? 'ASC' : 'DESC', 'NULLS LAST');
        break;
      default:
        idsQb.orderBy('l.createdAt', 'DESC');
    }

    const rows = await idsQb
      // `limit`/`offset`, not `take`/`skip`: this builder returns raw rows, so
      // there is no entity hydration for take/skip to protect.
      .limit(limit)
      .offset(offset)
      .getRawMany<{ id: string }>();

    return {
      items: await this.findManyInOrder(rows.map((r) => r.id)),
      total,
    };
  }

  countPublicByOwner(ownerId: string) {
    return this.countBy({ ownerId, status: ListingStatus.ACTIVE });
  }

  /**
   * How many live listings the seller has per purpose and per category.
   *
   * What the profile's filter sheet is built from: an option with nothing
   * behind it is not offered at all, and the ones that remain carry their
   * count. Cheap — two grouped counts over one seller's rows.
   */
  async facetsByOwner(ownerId: string): Promise<{
    purposes: Record<string, number>;
    categories: Record<string, number>;
  }> {
    const [purposes, categories] = await Promise.all([
      this.query<{ key: string; count: number }[]>(
        `SELECT o.purpose AS key, COUNT(DISTINCT l.id)::int AS count
           FROM listings l
           JOIN listing_offers o
             ON o.listing_id = l.id AND o.is_active = true
          WHERE l.owner_id = $1 AND l.status = 'ACTIVE'
          GROUP BY o.purpose`,
        [ownerId],
      ),
      this.query<{ key: string; count: number }[]>(
        `SELECT l.category AS key, COUNT(*)::int AS count
           FROM listings l
          WHERE l.owner_id = $1 AND l.status = 'ACTIVE'
          GROUP BY l.category`,
        [ownerId],
      ),
    ]);

    const toMap = (rows: { key: string; count: number }[]) =>
      Object.fromEntries(rows.map((r) => [r.key, r.count]));

    return { purposes: toMap(purposes), categories: toMap(categories) };
  }

  /**
   * The counts across the top of a profile. Views are already denormalised
   * onto each listing, so this is one pass over the seller's own rows — no
   * join, no per-listing round trip.
   *
   * The seller's RATING is not here: it is not an average of these rows (see
   * RatingService.ownerRating), and computing a second version of it from
   * `rating_avg` would be a number that disagrees with the profile.
   */
  async statsByOwner(ownerId: string): Promise<{
    listings: number;
    views: number;
  }> {
    const [row] = await this.query<{ listings: number; views: number }[]>(
      `SELECT COUNT(*)::int                     AS listings,
              COALESCE(SUM(view_count), 0)::int AS views
         FROM listings
        WHERE owner_id = $1 AND status = 'ACTIVE'`,
      [ownerId],
    );

    return { listings: row?.listings ?? 0, views: row?.views ?? 0 };
  }
}
