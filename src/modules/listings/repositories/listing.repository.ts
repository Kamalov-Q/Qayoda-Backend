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
