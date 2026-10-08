import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * One price an admin has put on something. Rows are entirely the admin's:
 * nothing is seeded, and an action with no active tariff is not charged.
 *
 * Per action code there is at most ONE tariff without a duration (a one-off
 * has nothing to choose between) and one per duration otherwise (e.g. TOP for
 * 3, 7 or 30 days — the user picks which to buy).
 */
@Entity('tariffs')
@Index('IDX_tariffs_one_off', ['action'], { unique: true, where: 'duration_days IS NULL' })
@Index('IDX_tariffs_timed', ['action', 'durationDays'], { unique: true, where: 'duration_days IS NOT NULL' })
export class Tariff {
    @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_tariffs' })
    id: string;

    /**
     * What this prices: one of the built-in TARIFF_ACTIONS (charged by the
     * server automatically) or a code the admin made up.
     */
    @Column({ type: 'varchar', length: 40 })
    action: string;

    @Column({ name: 'name_uz', type: 'varchar', length: 120 })
    nameUz: string;

    @Column({ name: 'name_ru', type: 'varchar', length: 120 })
    nameRu: string;

    @Column({ type: 'numeric', precision: 14, scale: 2, default: 0 })
    price: string;

    /** How long the paid effect lasts. Null = a one-off action with no duration. */
    @Column({ name: 'duration_days', type: 'int', nullable: true })
    durationDays: number | null;

    @Column({ name: 'is_active', type: 'boolean', default: true })
    isActive: boolean;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
    updatedAt: Date;
}
