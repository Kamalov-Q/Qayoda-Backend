import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { ListingOffer } from '../entities/listing-offer.entity';

@Injectable()
export class ListingOfferRepository extends Repository<ListingOffer> {
  constructor(private readonly dataSource: DataSource) {
    super(ListingOffer, dataSource.createEntityManager());
  }
}

