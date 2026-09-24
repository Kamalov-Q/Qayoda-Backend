import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

/**
 * One person's verdict on one listing — a star rating and, optionally, a few
 * words. Store-style: exactly one row per (listing, author), so re-reviewing
 * edits your own opinion instead of stacking another vote. That is what makes
 * the average mean "what N people think" rather than "how many times people
 * tapped".
 *
 * The author is a plain uuid, not a relation: same precedent as the reports
 * and chat tables — this module needs three columns of `users`, not its entity
 * graph, and a deleted account must not cascade away the reviews it left.
 */
@Entity('listing_reviews')
@Unique('uq_review_listing_author', ['listingId', 'authorId'])
export class ListingReview {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Index() @Column({ name: 'listing_id', type: 'uuid' }) listingId: string;
  @Index() @Column({ name: 'author_id', type: 'uuid' }) authorId: string;

  /** 1–5. smallint, because there is no sixth star coming. */
  @Column({ type: 'smallint' }) rating: number;

  /** A rating alone is a valid review; the text is the optional part. */
  @Column({ type: 'text', nullable: true }) comment: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}
