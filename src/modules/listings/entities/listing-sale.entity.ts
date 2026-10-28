// entities/listing-sale.entity.ts
//
// What a listing actually sold for.
//
// A separate table rather than columns on `listings`, for one hard reason and
// one soft one.
//
// The hard reason is that it must not leak. `findById` is the PUBLIC detail
// endpoint — no guard, no session needed — and it answers with
// `{ ...listing, owner }`: the whole entity, spread, with no serializer and
// no @Exclude anywhere in the codebase. A `sold_price` column on `Listing`
// would therefore be returned to every anonymous visitor the moment it was
// added, and would stay that way until somebody remembered to strip it. Here
// it cannot happen by accident: the row has to be asked for.
//
// That is not a privacy nicety. A seller who knows the figure is public will
// report a flattering one, and the admin comparison this table exists for is
// worth nothing if the numbers in it are decorative.
//
// The soft reason is that a sale is an EVENT — it happened on a date, for an
// amount, against one of the listing's offers — and an event belongs in a
// row of its own rather than as seven nullable columns on the thing it
// happened to.
import {
  Entity,
  PrimaryColumn,
  Column,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Listing } from './listing.entity';
import { OfferPurpose } from '../enums/offer-purpose.enum';

@Entity('listing_sales')
// Reporting runs over the date: "what sold last month, asking versus actual".
@Index('idx_listing_sales_sold_at', ['soldAt'])
export class ListingSale {
  /**
   * PK, not a generated id. A listing sells once — relisting it and selling
   * it again overwrites this row, because the question the table answers is
   * "what did it go for", not "what is its sales history". If that second
   * question ever matters this becomes a surrogate key and an index.
   */
  @PrimaryColumn('uuid', { name: 'listing_id' }) listingId: string;

  @ManyToOne(() => Listing, { onDelete: 'CASCADE', nullable: false })
  // Named explicitly, as the price_bids relations are: the entity and the
  // hand-written SQL are then provably the same constraint, rather than two
  // things that happen to agree until one of them is regenerated.
  @JoinColumn({
    name: 'listing_id',
    foreignKeyConstraintName: 'fk_listing_sales_listing',
  })
  listing: Listing;

  /**
   * Denormalised from the listing so a report never has to join back for the
   * one thing it always groups by, and — more importantly — so the figure
   * survives the listing being edited afterwards.
   */
  @Index('idx_listing_sales_owner')
  @Column({ name: 'owner_id', type: 'uuid' }) ownerId: string;

  /**
   * WHICH offer sold. A listing can carry a sale price and a monthly rent at
   * the same time, and comparing a sale figure against a rent asking price
   * is not a comparison — it is a bug that produces a plausible number.
   */
  @Column({ name: 'purpose', type: 'varchar', length: 16 })
  purpose: OfferPurpose;

  @Column({ type: 'numeric', precision: 14, scale: 2 }) price: number;
  @Column({ type: 'char', length: 3 }) currency: string;

  /** Normalised at write time, exactly as listing_offers.price_usd is. */
  @Column({
    name: 'price_usd',
    type: 'numeric',
    precision: 14,
    scale: 2,
    nullable: true,
  })
  priceUsd: number | null;

  /**
   * What was being ASKED at the moment of sale, snapshotted.
   *
   * Not read back off the offer at report time, for the same reason a bid
   * stores `askingAmount`: the seller can edit the price afterwards, and a
   * comparison whose baseline moves is one that quietly rewrites history. A
   * listing asking $60k that sold for $54k must still read as a 10% discount
   * next year, whatever the offer row says by then.
   */
  @Column({
    name: 'asking_price',
    type: 'numeric',
    precision: 14,
    scale: 2,
    nullable: true,
  })
  askingPrice: number | null;

  @Column({ name: 'asking_currency', type: 'char', length: 3, nullable: true })
  askingCurrency: string | null;

  /** The comparable figure. Asking and sold may be quoted in different money. */
  @Column({
    name: 'asking_price_usd',
    type: 'numeric',
    precision: 14,
    scale: 2,
    nullable: true,
  })
  askingPriceUsd: number | null;

  /**
   * When the seller said it sold, which is when they told us.
   *
   * Set explicitly, NOT a @CreateDateColumn: the row is keyed by listing, so
   * relisting and selling again is an UPDATE — and a create-timestamp does
   * not fire on an update, which would leave the second sale wearing the
   * first one's date.
   */
  @Column({ name: 'sold_at', type: 'timestamptz' })
  soldAt: Date;
}
