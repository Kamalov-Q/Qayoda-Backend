import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { Listing } from '../entities/listing.entity';

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
}
