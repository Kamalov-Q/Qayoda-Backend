// entities/listing.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { PropertyCategory } from '../enums/property-category.enum';
import { ListingStatus } from '../enums/listing-status.enum';
import { ListingImage } from './listing-image.entity';
import { ListingOffer } from './listing-offer.entity';
import type { GeoJsonPoint, GeoJsonPolygon } from '../types/geojson.type';

@Entity('listings')
export class Listing {
  @PrimaryGeneratedColumn('uuid') id: string;

  // Plain id — never a relation to iam's User entity (module boundary)
  @Index() @Column({ name: 'owner_id' }) ownerId: string;

  @Column({ type: 'enum', enum: PropertyCategory }) category: PropertyCategory;

  @Index()
  @Column({ type: 'enum', enum: ListingStatus, default: ListingStatus.DRAFT })
  status: ListingStatus;

  @Column({ type: 'varchar', length: 160, nullable: true }) title: string | null;
  @Column({ name: 'description_html', type: 'text', nullable: true })
  descriptionHtml: string | null;
  @Column({ name: 'description_text', type: 'text', nullable: true })
  descriptionText: string | null;
  @Column({ type: 'int', nullable: true }) rooms: number | null;
  @Column({
    name: 'area_m2',
    type: 'numeric',
    precision: 8,
    scale: 2,
    nullable: true,
  })
  areaM2: number | null;
  @Column({ type: 'int', nullable: true }) floor: number | null;
  @Column({ name: 'total_floors', type: 'int', nullable: true }) totalFloors:
    number | null;
  @Column({ type: 'text', nullable: true }) address: string | null;
  @Column({ name: 'contact_phone', type: 'varchar', length: 20, nullable: true })
  contactPhone: string | null;

  // GeoJSON, not WKT: TypeORM writes geography params through
  // ST_GeomFromGeoJSON and reads them back through ST_AsGeoJSON.
  @Index({ spatial: true })
  @Column({ type: 'geography', spatialFeatureType: 'Polygon', srid: 4326 })
  geom: GeoJsonPolygon;

  // Written by service at create/geometry-update time (synchronize:true can't
  // express Postgres GENERATED columns, so we compute it in SQL ourselves).
  @Index({ spatial: true })
  @Column({
    type: 'geography',
    spatialFeatureType: 'Point',
    srid: 4326,
    nullable: true,
  })
  centroid: GeoJsonPoint | null;

  @OneToMany(() => ListingOffer, (o) => o.listing, { cascade: true })
  offers: ListingOffer[];
  @OneToMany(() => ListingImage, (i) => i.listing, { cascade: true })
  images: ListingImage[];

  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt: Date | null;
}
