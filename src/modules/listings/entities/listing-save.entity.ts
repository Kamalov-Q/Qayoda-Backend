// entities/listing-save.entity.ts
// A user bookmarking a listing. Composite PK — one save per (user, listing),
// so saving twice is naturally an upsert rather than a duplicate.
import { Entity, PrimaryColumn, CreateDateColumn, Index } from 'typeorm';

@Entity('listing_saves')
export class ListingSave {
  // Plain ids on both sides — never relations across the iam module boundary,
  // and listings are joined by hand where the saved feed needs them.
  @PrimaryColumn('uuid', { name: 'user_id' }) userId: string;
  @Index() @PrimaryColumn('uuid', { name: 'listing_id' }) listingId: string;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
}
