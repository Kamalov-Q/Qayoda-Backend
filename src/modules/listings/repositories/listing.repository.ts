import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { Listing } from '../entities/listing.entity';
import { ListingStatus } from '../enums/listing-status.enum';

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

  findMine(ownerId: string) {
    return this.find({
      where: { ownerId },
      relations: { offers: true, images: true },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * The browsable feed: every ACTIVE listing, filtered and paged. Search goes
   * through title and address — the two fields people actually type.
   */
  findFeed(q: {
    purpose: string;
    category?: string;
    priceMin?: number;
    priceMax?: number;
    search?: string;
    sort: 'newest' | 'priceAsc' | 'priceDesc';
    limit: number;
    offset: number;
  }) {
    const qb = this.createQueryBuilder('l')
      .leftJoinAndSelect('l.offers', 'offer')
      .leftJoinAndSelect('l.images', 'image')
      // The purpose/price filter must run on its own join, or the joined-in
      // `offer` rows themselves get filtered and rent prices vanish from
      // cards on the SALE feed.
      .innerJoin(
        'l.offers',
        'match',
        'match.purpose = :purpose AND match.isActive = true',
        { purpose: q.purpose },
      )
      .where('l.status = :status', { status: ListingStatus.ACTIVE });

    if (q.category) qb.andWhere('l.category = :category', { category: q.category });
    // Bounds arrive in USD; priceUsd is the currency-blind comparison column.
    if (q.priceMin !== undefined)
      qb.andWhere('match.priceUsd >= :priceMin', { priceMin: q.priceMin });
    if (q.priceMax !== undefined)
      qb.andWhere('match.priceUsd <= :priceMax', { priceMax: q.priceMax });
    if (q.search) {
      qb.andWhere('(l.title ILIKE :search OR l.address ILIKE :search)', {
        search: `%${q.search.replace(/[\\%_]/g, '\\$&')}%`,
      });
    }

    if (q.sort === 'newest') {
      qb.orderBy('l.publishedAt', 'DESC');
    } else {
      // skip/take wraps the query in a DISTINCT-ids subquery, and Postgres
      // refuses to ORDER BY a joined column that subquery does not select —
      // "column distinctAlias.match_price does not exist". Selecting it under
      // the exact alias TypeORM will reference makes the wrapper legal.
      qb.addSelect('match.priceUsd', 'match_price');
      qb.orderBy('match.priceUsd', q.sort === 'priceAsc' ? 'ASC' : 'DESC');
    }

    return qb.skip(q.offset).take(q.limit).getMany();
  }

  /**
   * "More like this" for the detail page: same category, nearest first when
   * the anchor has a location, freshest first when it somehow does not.
   */
  findSimilar(anchor: Listing, limit: number) {
    const qb = this.createQueryBuilder('l')
      .leftJoinAndSelect('l.offers', 'offer')
      .leftJoinAndSelect('l.images', 'image')
      .where('l.status = :status', { status: ListingStatus.ACTIVE })
      .andWhere('l.id != :id', { id: anchor.id })
      .andWhere('l.category = :category', { category: anchor.category });

    // Defensive: a legacy row's centroid can come back malformed (or as raw
    // WKB on an odd driver/PostGIS pairing) — falling back to "freshest
    // first" beats a 500 on every detail page.
    const coords = anchor.centroid?.coordinates;
    if (Array.isArray(coords) && coords.length === 2) {
      const [lng, lat] = coords;
      qb.orderBy(
        'l.centroid <-> ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography',
        'ASC',
      ).setParameters({ lng, lat });
    } else {
      qb.orderBy('l.publishedAt', 'DESC');
    }

    return qb.take(limit).getMany();
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

  /** Same as `findMine`, minus the drafts and archived rows only the owner may see. */
  findPublicByOwner(ownerId: string) {
    return this.find({
      where: { ownerId, status: ListingStatus.ACTIVE },
      relations: { offers: true, images: true },
      order: { createdAt: 'DESC' },
    });
  }
}
