import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
@Entity('wallets')
export class Wallet {
    @PrimaryColumn({ name: 'user_id', type: 'uuid' })
    userId: string;

    @Column({ type: 'numeric', precision: 14, scale: 2, default: 0 })
    balance: string;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
    updatedAt: Date;
}