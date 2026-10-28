import {
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Listing } from './listing.entity';


/**
 * A photo on an advert.
 *
 * The index is load-bearing and was missing. `listing_id` carries a foreign
 * key, and a foreign key does NOT index its own column in Postgres — only
 * the referenced side is indexed, by its primary key. So every query that
 * hydrated images (which is every feed page, every card list, every map
 * preview — `relations: { images: true }` becomes
 * `WHERE listing_id IN (...)`) seq-scanned this table, and so did the
 * ON DELETE CASCADE for each listing removed.
 */
@Entity('listing_images')
@Index('idx_listing_images_listing', ['listingId', 'isPrimary', 'position'])
export class ListingImage {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'listing_id' }) listingId: string;
  @ManyToOne(() => Listing, (l) => l.images, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'listing_id' })
  listing: Listing;
  @Column({ type: 'text' }) url: string;
  @Column({ name: 'thumb_url', type: 'text' }) thumbUrl: string;
  @Column({ type: 'int', nullable: true }) width: number | null;
  @Column({ type: 'int', nullable: true }) height: number | null;
  @Column({ type: 'int', default: 0 }) position: number;
  @Column({ name: 'is_primary', default: false }) isPrimary: boolean;
}
