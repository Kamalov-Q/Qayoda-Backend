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
import { OfferPurpose } from '../enums/offer-purpose.enum';
import type { GeoJsonPoint } from '../types/geojson.type';

@Entity('listing_map_points')
export class ListingMapPoint {
  @PrimaryColumn('uuid', { name: 'listing_id' }) listingId: string;
  @PrimaryColumn({ type: 'enum', enum: OfferPurpose }) purpose: OfferPurpose;
  /** Category slug — varchar(40) to match the conversion in pre-sync.ts. */
  @Column({ type: 'varchar', length: 40 }) category: string;
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

  /**
   * Denormalised for the viewport's search, which is "title or address" —
   * never returned to clients. Without it the search box matched only
   * addresses once the map zoomed out to points, so typing a listing's name
   * emptied the map while filling the list.
   */
  @Column({ type: 'text', nullable: true }) title: string | null;

  /**
   * The listing behind this pin has sold.
   *
   * The pin STAYS — a sold advert used to be deleted from this projection,
   * which kept the map clean and threw away the only record of where a sale
   * happened. It is drawn differently instead (yellow), so a buyer can see
   * at a glance what is still available and what has already gone.
   *
   * `price` on a sold row remains the ASKING price, deliberately. What it
   * actually went for lives in listing_sales, which this projection does not
   * read: the viewport endpoint is public, and a seller's negotiated figure
   * is not something to publish to anyone panning the map.
   */
  @Index('idx_listing_map_points_sold', ['sold'], { where: 'sold' })
  @Column({ type: 'boolean', default: false }) sold: boolean;

  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
