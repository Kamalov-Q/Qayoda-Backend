import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Listing } from './listing.entity';


@Entity('listing_images')
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
