import { Check, Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
@Entity('wallets')
// The floor every debit relies on. Charging checks the balance first, but
// two concurrent charges can both pass that check — this is what stops the
// second one committing a negative balance.
@Check('wallets_balance_check', '"balance" >= 0')
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