import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Unique,
} from 'typeorm';
import { Listing } from './listing.entity';
import { OfferPurpose } from '../enums/offer-purpose.enum';

@Entity('listing_offers')
@Unique(['listingId', 'purpose'])
export class ListingOffer {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'listing_id' }) listingId: string;
  @ManyToOne(() => Listing, (l) => l.offers, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'listing_id' })
  listing: Listing;
  @Column({ type: 'enum', enum: OfferPurpose }) purpose: OfferPurpose;
  @Column({ type: 'numeric', precision: 14, scale: 2 }) price: number;
  @Column({ type: 'char', length: 3, default: 'USD' }) currency: string;
  @Column({ name: 'is_active', default: true }) isActive: boolean;
}
