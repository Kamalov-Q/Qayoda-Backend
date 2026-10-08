
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

@Entity('topup_bonus_tiers')
@Unique('UQ_topup_bonus_tiers_min_amount', ['minAmount'])
export class BonusTier {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'min_amount', type: 'numeric', precision: 14, scale: 2 })
    minAmount: string;

    @Column({ type: 'int' })
    percent: number;

    @Column({ name: 'is_active', type: 'boolean', default: true })
    isActive: boolean;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt: Date;

}

