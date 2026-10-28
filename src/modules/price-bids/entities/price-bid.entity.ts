import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Listing } from '../../listings/entities/listing.entity';
import { User } from '../../users/entities/user.entity';
import { Conversation } from '../../chat/entities/conversation.entity';
import { Message } from '../../chat/entities/message.entity';
import { OfferPurpose } from '../../listings/enums/offer-purpose.enum';
import { PriceBidDirection } from '../enums/price-bid-direction.enum';
import { PriceBidStatus } from '../enums/price-bid-status.enum';

/**
 * One number, offered by one person, on one advert.
 *
 * Deliberately NOT called an Offer: `listing_offers` already owns that word
 * and means the asking price the seller published. This is the other side of
 * that conversation, and a codebase where "offer" means both is a codebase
 * where every query needs a second look.
 *
 * The bid is a row rather than just a chat message because it has a lifecycle
 * a message does not: it can be accepted, countered, withdrawn, and it lapses
 * on its own. The message in the thread is how it is SHOWN; this is what it
 * IS. See `messageId` for the join between the two.
 */
@Entity('price_bids')
// One live bid per person per advert, enforced here rather than hoped for in
// the service. Declared on the entity as well as in the migration because
// `synchronize` (on in dev) drops any index the entities do not know about —
// an index that exists only in the SQL file is an index that survives until
// the next developer boots the server.
@Index('uq_price_bids_open_per_bidder', ['listingId', 'bidderId'], {
  unique: true,
  where: "status = 'PENDING'",
})
// The owner's view: "what is open on this advert", newest first.
@Index('idx_price_bids_listing_status', ['listingId', 'status', 'createdAt'])
// The bidder's view: "what have I offered, anywhere".
@Index('idx_price_bids_bidder', ['bidderId', 'createdAt'])
// The sweep that expires them. Partial on exactly the rows that can be due.
@Index('idx_price_bids_expiry', ['expiresAt'], { where: "status = 'PENDING'" })
// The seller's side of /me/bids. listMine asks for `bidderId = me OR ownerId
// = me`, and only the bidder half had an index — so every seller opening
// their negotiations seq-scanned the table.
@Index('idx_price_bids_owner', ['ownerId', 'createdAt'])
// Not for any query this app makes: these three exist so the foreign keys
// added alongside them are cheap. Postgres does NOT index a referencing
// column on its own, and an ON DELETE SET NULL has to find the children of
// the row being deleted — without an index that is a full scan of price_bids
// per deleted conversation, message or superseding bid.
@Index('idx_price_bids_conversation', ['conversationId'], {
  where: 'conversation_id IS NOT NULL',
})
@Index('idx_price_bids_message', ['messageId'], {
  where: 'message_id IS NOT NULL',
})
@Index('idx_price_bids_superseded_by', ['supersededById'], {
  where: 'superseded_by_id IS NOT NULL',
})
export class PriceBid {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column({ name: 'listing_id', type: 'uuid' }) listingId: string;

  /**
   * The six references below carry foreign keys. This table shipped without
   * any, which left every id in it a uuid the database had no opinion about:
   * nothing stopped a bid being written against a listing that did not
   * exist, and nothing defined what should happen to one if the row it
   * points at ever went away.
   *
   * Declared on the entity AND in sql/2026-10-28-price-bids.sql, for the
   * reason the indexes above give — `synchronize` drops what the entities do
   * not know about. Named explicitly rather than left to TypeORM's hash so
   * the two declarations are the same constraint by construction, and so
   * `npm run schema:sql` stays quiet; the older tables wear generated names
   * only because they predate this module's convention.
   *
   * Nullability is restated on each relation. A @ManyToOne defaults to
   * nullable, and left unsaid it would argue with the @Column beside it
   * about whether the column may be NULL.
   *
   * Nothing in the application hard-deletes a listing, a user, a
   * conversation or a message — account deletion scrubs the row and sets
   * `deleted_at`, and archiving is this app's delete — so none of these
   * CASCADEs can fire today. They are here to define the answer for the
   * paths that do not go through the application: an admin statement, a data
   * migration, a real erasure request.
   */
  @ManyToOne(() => Listing, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({
    name: 'listing_id',
    foreignKeyConstraintName: 'fk_price_bids_listing',
  })
  listing: Listing;

  /**
   * The buyer — on BOTH directions.
   *
   * A counter from the seller is still part of the buyer's negotiation, so
   * the pair (listing, bidder) identifies the whole exchange regardless of
   * who spoke last. That is what the partial unique index keys on, and what
   * makes "one open bid per person per advert" enforceable in the database
   * rather than hopefully in the service.
   */
  @Column({ name: 'bidder_id', type: 'uuid' }) bidderId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({
    name: 'bidder_id',
    foreignKeyConstraintName: 'fk_price_bids_bidder',
  })
  bidder: User;

  /**
   * The seller at the time of bidding, snapshotted.
   *
   * Saves a join on every permission check, and stays correct if the advert
   * is ever transferred — the person who was owed an answer is the person who
   * owned it when the number was offered.
   */
  @Column({ name: 'owner_id', type: 'uuid' }) ownerId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({
    name: 'owner_id',
    foreignKeyConstraintName: 'fk_price_bids_owner',
  })
  owner: User;

  /** The thread this bid was posted into. Null only if chat creation failed. */
  @Column({ name: 'conversation_id', type: 'uuid', nullable: true })
  conversationId: string | null;

  // SET NULL, not CASCADE: the bid is the record of a number having been
  // offered, and that stays true whether or not the thread it was posted
  // into still exists.
  @ManyToOne(() => Conversation, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({
    name: 'conversation_id',
    foreignKeyConstraintName: 'fk_price_bids_conversation',
  })
  conversation: Conversation | null;

  /**
   * The chat message that renders this bid.
   *
   * An ordinary TEXT message carrying this bid's id, not a new MessageType —
   * see sql/2026-10-28-price-bids.sql for why that matters to clients that
   * shipped before bids existed.
   */
  @Column({ name: 'message_id', type: 'uuid', nullable: true })
  messageId: string | null;

  @ManyToOne(() => Message, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({
    name: 'message_id',
    foreignKeyConstraintName: 'fk_price_bids_message',
  })
  message: Message | null;

  @Column({ type: 'varchar', length: 8 }) direction: PriceBidDirection;

  @Column({ type: 'varchar', length: 16, default: PriceBidStatus.PENDING })
  status: PriceBidStatus;

  /** Which of the listing's asking prices this is against. */
  @Column({ type: 'varchar', length: 16 }) purpose: OfferPurpose;

  @Column({ type: 'numeric', precision: 14, scale: 2 }) amount: string;
  @Column({ type: 'char', length: 3, default: 'USD' }) currency: string;

  /**
   * `amount` in USD at the time of the bid. Same reasoning as
   * ListingOffer.priceUsd: comparing so'm against dollars is not a
   * comparison, and every list that sorts or filters bids needs one scale.
   */
  @Column({
    name: 'amount_usd',
    type: 'numeric',
    precision: 14,
    scale: 2,
    nullable: true,
  })
  amountUsd: string | null;

  /**
   * What was being asked when the bid was made, snapshotted.
   *
   * The card says "−10% off 27 850 $" for as long as it exists. A join to
   * the live asking price makes that sentence change under the reader when
   * the seller edits it, which is how a record of a negotiation stops being
   * a record.
   */
  @Column({
    name: 'asking_amount',
    type: 'numeric',
    precision: 14,
    scale: 2,
    nullable: true,
  })
  askingAmount: string | null;

  @Column({
    name: 'asking_currency',
    type: 'char',
    length: 3,
    nullable: true,
  })
  askingCurrency: string | null;

  /** When it stops standing. Enforced on read as well as by the sweep. */
  @Column({ name: 'expires_at', type: 'timestamptz' }) expiresAt: Date;

  /** When it left PENDING, whichever way it went. */
  @Column({ name: 'responded_at', type: 'timestamptz', nullable: true })
  respondedAt: Date | null;

  /** The counter that replaced this one, when status is COUNTERED. */
  @Column({ name: 'superseded_by_id', type: 'uuid', nullable: true })
  supersededById: string | null;

  // Self-referential, so SET NULL is the only safe answer: CASCADE here
  // would let removing the newest counter take the entire negotiation behind
  // it down the chain.
  @ManyToOne(() => PriceBid, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({
    name: 'superseded_by_id',
    foreignKeyConstraintName: 'fk_price_bids_superseded_by',
  })
  supersededBy: PriceBid | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
