// entities/listing-map-point.entity.ts
// Read-model projection: ONLY written by project-map-point.listener.ts.
// Composite PK (listing, purpose) — one listing can appear once per purpose.
import {
  Entity,
  PrimaryColumn,
  Column,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { PropertyCategory } from '../enums/property-category.enum';
import { OfferPurpose } from '../enums/offer-purpose.enum';

@Entity('listing_map_points')
export class ListingMapPoint {
  @PrimaryColumn('uuid', { name: 'listing_id' }) listingId: string;
  @PrimaryColumn({ type: 'enum', enum: OfferPurpose }) purpose: OfferPurpose;
  @Column({ type: 'enum', enum: PropertyCategory }) category: PropertyCategory;
  @Column({ type: 'numeric', precision: 14, scale: 2 }) price: number;
  @Column({ type: 'char', length: 3 }) currency: string;
  @Index({ spatial: true })
  @Column({ type: 'geography', spatialFeatureType: 'Point', srid: 4326 })
  centroid: string;
  @Column({ name: 'thumb_url', type: 'text', nullable: true }) thumbUrl:
    string | null;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
