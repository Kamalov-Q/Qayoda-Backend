
import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import type { TariffKey } from '../billing.constants';

@Entity('tariffs')
export class Tariff {
    @PrimaryColumn({ type: 'varchar', length: 40 })
    key: TariffKey;

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

    @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
    updatedAt: Date;

}
