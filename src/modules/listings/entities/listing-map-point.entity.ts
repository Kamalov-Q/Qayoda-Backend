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
   * The listing behind this point has sold.
   *
   * The ROW is kept and the PIN is not shown. Those are two different
   * decisions and both are deliberate:
   *
   * Not shown, because a sold advert is not something a buyer can act on and
   * the map is finite — every feature competes for a fixed LIMIT, so sold
   * points accumulating forever would steadily crowd out the listings that
   * are still for sale. The viewport query filters on this column.
   *
   * Kept, because deleting it destroys the only record of WHERE a sale
   * happened, irreversibly — nothing else stores the point once the listing
   * is off the map. Location plus date plus (via listing_sales) the actual
   * price is the dataset that makes "what is anything worth around here"
   * answerable, and it cannot be reconstructed later.
   *
   * Somebody who wants a sold listing's location opens the listing: its
   * detail page draws its own map from the listing's own geometry, which
   * markSold never touches.
   *
   * `price` on a sold row remains the ASKING price. What it actually went
   * for lives in listing_sales, which this projection does not read.
   */
  // Partial on the sold rows, which are the minority and the ones a
  // comparables report would ask for. The viewport's `sold = false` filter
  // rides on the spatial index instead — it is the ST_Intersects that
  // selects, and this is only a predicate applied to what that returns.
  @Index('idx_listing_map_points_sold', ['sold'], { where: 'sold' })
  @Column({ type: 'boolean', default: false }) sold: boolean;

  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
