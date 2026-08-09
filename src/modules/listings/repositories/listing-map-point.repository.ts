import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { ListingMapPoint } from '../entities/listing-map-point.entity';

@Injectable()
export class ListingMapPointRepository extends Repository<ListingMapPoint> {
  constructor(private readonly dataSource: DataSource) {
    super(ListingMapPoint, dataSource.createEntityManager());
  }
}
