// entities/listing.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
  OneToOne,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { ListingStatus } from '../enums/listing-status.enum';
import {
  BuildingType,
  RepairType,
  SellerType,
} from '../enums/seller-type.enum';
import { ListingImage } from './listing-image.entity';
import { ListingVideo } from '../../listing-videos/entities/listing-video.entity';
import { ListingOffer } from './listing-offer.entity';
import type { GeoJsonPoint, GeoJsonPolygon } from '../types/geojson.type';

@Entity('listings')
export class Listing {
  @PrimaryGeneratedColumn('uuid') id: string;

  // Plain id — never a relation to the users module's User entity
  @Index() @Column({ name: 'owner_id', type: 'uuid' }) ownerId: string;

  /**
   * A category slug (see the categories table). Was a Postgres enum; now text
   * so admins can add categories. The column was converted in place by
   * pre-sync.ts — varchar(40) here must keep matching that, or synchronize
   * would "fix" the difference by dropping the column.
   */
  @Index()
  @Column({ type: 'varchar', length: 40 })
  category: string;

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
  /**
   * Whether the advert comes from the owner or an agent. Nullable because
   * every listing posted before this existed has no answer, and guessing one
   * would put a claim in the seller's mouth.
   */
  @Index()
  @Column({
    name: 'seller_type',
    type: 'enum',
    enum: SellerType,
    nullable: true,
  })
  sellerType: SellerType | null;

  /** How finished it is. Null when the seller skipped it. */
  @Index()
  @Column({
    name: 'repair_type',
    type: 'enum',
    enum: RepairType,
    nullable: true,
  })
  repairType: RepairType | null;

  /** New build or resale. Null for land, and for older listings. */
  @Index()
  @Column({
    name: 'building_type',
    type: 'enum',
    enum: BuildingType,
    nullable: true,
  })
  buildingType: BuildingType | null;

  /** Auto-derived from the drawn boundary (reverse geocode) — not typed. */
  @Column({ type: 'text', nullable: true }) address: string | null;

  /** Amenity keys from the amenities table (see AmenitiesModule). */
  @Column({ type: 'jsonb', nullable: true })
  properties: string[] | null;


  @Column({ name: 'contact_phone', type: 'varchar', length: 20, nullable: true })
  contactPhone: string | null;

  // GeoJSON, not WKT: TypeORM writes geography params through
  // ST_GeomFromGeoJSON and reads them back through ST_AsGeoJSON.
  // Nullable since pins arrived: a POLYGON listing carries a drawn boundary,
  // a PIN listing carries only `centroid`. Exactly one location shape exists
  // either way — the service refuses a listing with neither.
  @Index({ spatial: true })
  @Column({
    type: 'geography',
    spatialFeatureType: 'Polygon',
    srid: 4326,
    nullable: true,
  })
  geom: GeoJsonPolygon | null;

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

  /**
   * The listing's stars, decided by RatingService and rewritten whenever a
   * review lands or a moderator upholds a report. It lives here so that stars
   * cost nothing to show: every feed, card, profile and saved-list query
   * already selects this entity, and computing it per card would be a join
   * per card.
   *
   * Never null, and five to begin with: a listing nobody has rated is not a
   * bad listing. See RatingService for what moves it off five.
   *
   * `real`, not `numeric`: node-postgres hands float4 back as a JS number,
   * while numeric arrives as a string (see `areaM2`). One decimal place of a
   * five-point scale does not need more precision than that.
   */
  @Column({ name: 'rating_avg', type: 'real', default: 5 })
  ratingAvg: number;

  /**
   * How many people REVIEWED it — the "(12)" beside the stars.
   *
   * Not how many votes went into `ratingAvg`: the prior and any upheld
   * reports weigh on the score without being things anyone wrote. Counting
   * them here would tell a reader that twelve people had spoken when four
   * had.
   */
  @Column({ name: 'rating_count', type: 'int', default: 0 })
  ratingCount: number;

  /**
   * Top-level comments, denormalized from `listing_comments` the same way
   * the rating and view count are. A comment icon on a card with no number
   * beside it tells a reader nothing — and counting per card would be a
   * query per row of the feed.
   */
  @Column({ name: 'comment_count', type: 'int', default: 0 })
  commentCount: number;

  /**
   * Distinct viewers, denormalized from `listing_views` the same way the
   * rating is: every feed and card query already selects this entity, so the
   * number costs nothing to show and a COUNT per card would cost a lot.
   */
  @Column({ name: 'view_count', type: 'int', default: 0 })
  viewCount: number;

  @OneToMany(() => ListingOffer, (o) => o.listing, { cascade: true })
  offers: ListingOffer[];
  @OneToMany(() => ListingImage, (i) => i.listing, { cascade: true })
  images: ListingImage[];

  /**
   * The walkthrough film, if this advert has one. At most one, ever.
   *
   * A relation rather than a lookup so that every place a listing is loaded
   * with its images gets the video with them — it is a slide in the same
   * gallery, and a second round trip for the first thing on the screen is
   * the wrong shape.
   */
  @OneToOne(() => ListingVideo, (v) => v.listing)
  video: ListingVideo | null;

  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt: Date | null;

  /**
   * Paid "TOP" placement: the feed ranks the listing first until this.
   *
   * Null while a promotion is PAUSED — see promotionRemainingSeconds. That
   * is deliberately the same null as "never promoted", so every reader of
   * this column (the feed's ranking expression, the badge on the card, the
   * badge on the detail page) treats a paused promotion as not promoted
   * without having to know that pausing exists. An extra flag to check is a
   * flag somebody forgets to check.
   */
  @Column({ name: 'promoted_until', type: 'timestamptz', nullable: true })
  promotedUntil: Date | null;

  /**
   * TOP days bought and not yet served, banked while the advert is down.
   *
   * A promotion used to keep burning after a listing was sold or archived:
   * the listing was out of every feed (they all filter to ACTIVE) while its
   * `promoted_until` ticked away, so a seller who sold on day three of a
   * seven-day TOP package paid for four days of placement that could not
   * reach anybody. Nobody was charged twice, which is exactly why it went
   * unnoticed.
   *
   * Taking the advert down now moves the remainder here and clears
   * `promoted_until`; restoring it does the reverse, from `now()`. Seconds
   * rather than an end date, because what was bought is a DURATION — an end
   * date parked across an archive of unknown length is a number that means
   * nothing by the time it is read.
   *
   * Null means nothing is banked. An ALREADY EXPIRED promotion is left
   * exactly where it is, in `promoted_until`: a past date is the admin
   * queue's signal that somebody paid once and may pay again, and banking
   * zero seconds would erase it.
   */
  @Column({ name: 'promotion_remaining_seconds', type: 'int', nullable: true })
  promotionRemainingSeconds: number | null;
}
