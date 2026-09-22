import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { ListingSave } from '../entities/listing-save.entity';
import { Listing } from '../entities/listing.entity';

@Injectable()
export class ListingSaveRepository extends Repository<ListingSave> {
  constructor(private readonly dataSource: DataSource) {
    super(ListingSave, dataSource.createEntityManager());
  }

  /** Idempotent: a second save of the same listing is a no-op, not an error. */
  async saveFor(userId: string, listingId: string) {
    await this.createQueryBuilder()
      .insert()
      .values({ userId, listingId })
      .orIgnore()
      .execute();
  }

  /** Also idempotent — unsaving something never saved simply deletes nothing. */
  async unsaveFor(userId: string, listingId: string) {
    await this.delete({ userId, listingId });
  }

  /** The user's saved listings, most recently saved first, with the same
   *  relations `findMine` loads so both feeds share one client shape.
   *
   *  Paged in two steps (ids first, no joins; then hydrate) — take/skip on a
   *  joined query reawakens TypeORM's DISTINCT-wrapper failures. Without
   *  limit it keeps the original single-query path. */
  async findSavedFor(userId: string, limit?: number, offset?: number) {
    if (limit == null) {
      return this.dataSource
        .getRepository(Listing)
        .createQueryBuilder('l')
        .innerJoin(
          ListingSave,
          's',
          's.listingId = l.id AND s.userId = :userId',
          { userId },
        )
        .leftJoinAndSelect('l.offers', 'offers')
        .leftJoinAndSelect('l.images', 'images')
        .orderBy('s.createdAt', 'DESC')
        .getMany();
    }

    const saves = await this.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset ?? 0,
    });
    if (saves.length === 0) return [];

    const ids = saves.map((s) => s.listingId);
    const listings = await this.dataSource.getRepository(Listing).find({
      where: ids.map((id) => ({ id })),
      relations: { offers: true, images: true },
    });
    const rank = new Map(ids.map((id, i) => [id, i]));
    return listings.sort(
      (a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0),
    );
  }

  /** Just the ids, cheap at any count — what the app's hearts subscribe to. */
  async findSavedIdsFor(userId: string): Promise<string[]> {
    const rows = await this.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      select: { listingId: true },
    });
    return rows.map((r) => r.listingId);
  }
}
