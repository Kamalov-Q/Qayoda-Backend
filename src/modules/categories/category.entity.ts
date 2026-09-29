import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * A kind of property (Kvartira, Hovli, Mehmonxona, …), managed from the admin
 * dashboard. Listings reference it by `slug`, which is the value they already
 * stored when categories were a fixed enum — so the switch to data changed no
 * listing row.
 */
@Entity('categories')
export class Category {
  /** e.g. APARTMENT. Immutable: listings store it. */
  @PrimaryColumn({ type: 'varchar', length: 40 }) slug: string;

  @Column({ name: 'name_uz', type: 'varchar', length: 60 }) nameUz: string;
  @Column({ name: 'name_ru', type: 'varchar', length: 60 }) nameRu: string;

  /** One of CATEGORY_ICON_KEYS. */
  @Column({ type: 'varchar', length: 40, default: 'grid' }) icon: string;

  @Column({ name: 'sort_order', type: 'int', default: 0 }) sortOrder: number;

  /**
   * Hidden categories stay valid for the listings already in them, but the
   * app stops offering them for new listings and filters.
   */
  @Column({ name: 'is_active', type: 'boolean', default: true }) isActive: boolean;

  /**
   * Whether a listing in this category may have a floor / total floors. A
   * flat or an office is "floor 4 of 9"; a plot or a house is the whole thing.
   */
  @Column({ name: 'floor_capable', type: 'boolean', default: false })
  floorCapable: boolean;

  /**
   * Whether a listing in this category is a new build or a resale. A flat is
   * one or the other; a plot of land is neither, and asking would only give
   * the seller a question with no right answer.
   */
  @Column({ name: 'building_type_capable', type: 'boolean', default: false })
  buildingTypeCapable: boolean;

  /**
   * Whether it makes sense to ask about the state of repair. Everything with
   * walls has one; land does not.
   */
  @Column({ name: 'repair_type_capable', type: 'boolean', default: false })
  repairTypeCapable: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}
