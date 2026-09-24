import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

/**
 * One row per person per listing — the whole point of the table. A counter
 * column on its own would answer "how many times was this opened", which on a
 * listing people revisit while deciding is a number about indecision rather
 * than about interest.
 *
 * Who a "person" is depends on whether they are signed in:
 *
 * - signed in → `u:<userId>`, which follows them across devices;
 * - signed out → `d:<deviceId>`, a value the app generates once and keeps.
 *
 * The device key is forgeable, and that is fine: this is a view counter, not
 * an audit log, and the cost of a wrong number is a wrong number.
 */
@Entity('listing_views')
@Unique('uq_view_listing_viewer', ['listingId', 'viewerKey'])
export class ListingView {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Index() @Column({ name: 'listing_id', type: 'uuid' }) listingId: string;

  /** `u:<uuid>` or `d:<deviceId>` — see the class comment. */
  @Column({ name: 'viewer_key', type: 'varchar', length: 80 })
  viewerKey: string;

  /** Set when the viewer was signed in; null for a guest. */
  @Index()
  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}
