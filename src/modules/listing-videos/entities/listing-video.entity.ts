import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Listing } from '../../listings/entities/listing.entity';
import { ListingVideoStatus } from '../listing-videos.constants';

/**
 * The film of a property: one walkthrough, attached to one advert.
 *
 * Its own table, deliberately, even though `videos` already stores clips that
 * can point at a listing. The two look alike and behave nothing alike:
 *
 * - A reel is a POST. It is published, it is paid for, it is ranked in a
 *   feed, it collects likes, comments and views, and it can be reported and
 *   taken down while the listing it advertises stays up.
 * - A tour is a PHOTO THAT MOVES. It is a slide in the gallery, it is part of
 *   the advert its owner already paid to post, it has no feed, no counters,
 *   nothing to like and nobody to report it to separately. Deleting the
 *   listing deletes it, which is exactly what you want of a photo and exactly
 *   what you do not want of somebody's published post.
 *
 * Folding both into `videos` would mean every feed query filtering out tours,
 * every counter column sitting null on half the rows, and a moderation queue
 * where taking down "a video" sometimes guts an advert's gallery instead.
 * What the two genuinely share is the upload pipeline — the Bunny object, the
 * tus ticket, the webhook, the encode — and that is shared, as a service.
 *
 * ONE per listing: `listing_id` is unique. A gallery of near-identical
 * walkthroughs is not a feature anybody asked for, and "replace the video"
 * is a far simpler thing to put in a UI than "manage your videos".
 */
@Entity('listing_videos')
@Index('IDX_listing_videos_provider', ['providerId'], { unique: true })
@Index('IDX_listing_videos_listing', ['listingId'], { unique: true })
@Index('IDX_listing_videos_pending', ['status', 'updatedAt'])
export class ListingVideo {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column({ name: 'listing_id', type: 'uuid' }) listingId: string;

  @OneToOne(() => Listing, (l) => l.video, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'listing_id' })
  listing: Listing;

  /**
   * Copied from the listing rather than joined for it.
   *
   * Every write here is an ownership check, and a tour outlives nothing: if
   * the listing is gone the row is gone with it. One column saves a join on
   * the hot path of "is this yours".
   */
  @Column({ name: 'owner_id', type: 'uuid' }) ownerId: string;

  /** The Bunny Stream video GUID — the only handle on the actual bytes. */
  @Column({ name: 'provider_id', type: 'varchar', length: 64 })
  providerId: string;

  @Column({ type: 'varchar', length: 20, default: ListingVideoStatus.UPLOADING })
  status: ListingVideoStatus;

  /** Why it will never play. Null unless status is FAILED. */
  @Column({ name: 'fail_reason', type: 'varchar', length: 32, nullable: true })
  failReason: string | null;

  /**
   * As Bunny measured the encoded file, not as the phone described it. The
   * three-minute limit is enforced against this number.
   */
  @Column({ name: 'duration_sec', type: 'real', nullable: true })
  durationSec: number | null;

  @Column({ type: 'int', nullable: true }) width: number | null;
  @Column({ type: 'int', nullable: true }) height: number | null;

  /**
   * Bunny's name for the poster frame, e.g. `thumbnail.jpg`. Stored rather
   * than assumed: Bunny picks the name, and a guessed one is a broken first
   * slide on every gallery.
   */
  @Column({
    name: 'thumbnail_file',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  thumbnailFile: string | null;

  /**
   * Playback URLs, STORED rather than derived.
   *
   * The reels service derives these from the Bunny guid every time, because
   * a reel is shaped into a response object anyway. A tour is not: it rides
   * out as a plain relation on the listing, so whatever the gallery needs
   * has to be a column or it is not there at all. The alternative was
   * teaching five listing queries to post-process their rows.
   *
   * Null until the file is playable — which is also how a client tells.
   */
  @Column({ name: 'hls_url', type: 'text', nullable: true })
  hlsUrl: string | null;

  @Column({ name: 'thumb_url', type: 'text', nullable: true })
  thumbUrl: string | null;

  /** When it became playable. Null while encoding, or if it failed. */
  @Column({ name: 'ready_at', type: 'timestamptz', nullable: true })
  readyAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
