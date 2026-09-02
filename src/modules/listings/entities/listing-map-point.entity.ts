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
import type { GeoJsonPoint } from '../types/geojson.type';

@Entity('listing_map_points')
export class ListingMapPoint {
  @PrimaryColumn('uuid', { name: 'listing_id' }) listingId: string;
  @PrimaryColumn({ type: 'enum', enum: OfferPurpose }) purpose: OfferPurpose;
  @Column({ type: 'enum', enum: PropertyCategory }) category: PropertyCategory;
  @Column({ type: 'numeric', precision: 14, scale: 2 }) price: number;
  @Column({ type: 'char', length: 3 }) currency: string;

  /** Normalised for currency-blind price filtering, same as the offer row. */
  @Column({ name: 'price_usd', type: 'numeric', precision: 14, scale: 2, nullable: true })
  priceUsd: number | null;
  @Index({ spatial: true })
  @Column({ type: 'geography', spatialFeatureType: 'Point', srid: 4326 })
  centroid: GeoJsonPoint;
  @Column({ name: 'thumb_url', type: 'text', nullable: true }) thumbUrl:
    string | null;
  /** Denormalised for the viewport's address filter — never returned to clients. */
  @Column({ type: 'text', nullable: true }) address: string | null;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
