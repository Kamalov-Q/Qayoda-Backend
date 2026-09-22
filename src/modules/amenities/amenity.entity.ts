import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * An amenity a listing can offer (Ta'mirlangan, Konditsioner, …), managed from
 * the admin dashboard the same way categories are. Listings store an array of
 * `key`s in their jsonb `properties` column — the keys existing listings
 * already carry from when this list was hard-coded, so the switch to data
 * changed no listing row.
 */
@Entity('amenities')
export class Amenity {
  /** e.g. REPAIRED. Immutable: listings store it. */
  @PrimaryColumn({ type: 'varchar', length: 40 }) key: string;

  @Column({ name: 'name_uz', type: 'varchar', length: 60 }) nameUz: string;
  @Column({ name: 'name_ru', type: 'varchar', length: 60 }) nameRu: string;

  @Column({ name: 'sort_order', type: 'int', default: 0 }) sortOrder: number;

  /**
   * Hidden amenities stay on the listings that picked them, but the app stops
   * offering them on the post form.
   */
  @Column({ name: 'is_active', type: 'boolean', default: true }) isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}
