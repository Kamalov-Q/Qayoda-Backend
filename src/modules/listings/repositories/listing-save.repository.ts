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
   *  relations `findMine` loads so both feeds share one client shape. */
  findSavedFor(userId: string) {
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
}
