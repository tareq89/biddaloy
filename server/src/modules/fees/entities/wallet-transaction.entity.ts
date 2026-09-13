import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { WalletTransactionKind } from '@biddaloy/shared';
import { StudentWallet } from './student-wallet.entity';

/**
 * One entry in a `StudentWallet`'s append-only ledger (16.1.5).
 *
 * `amount` is signed: positive for a credit (`CREDIT_OVERPAYMENT`,
 * `CREDIT_CHANGE`), negative for a debit (`DEBIT_CHECKOUT`,
 * `DEBIT_GENERATION`) or a `REVERSAL`. Every row is written by
 * `WalletService` in the same DB transaction as the `StudentWallet.balance`
 * update it explains — the two never drift because nothing else may write
 * either.
 *
 * Write-only, like `audit_logs`: `trg_wallet_transactions_write_only`
 * (added by this table's migration) rejects UPDATE/DELETE at the DB level,
 * so mistakes are corrected by inserting a compensating `REVERSAL` row
 * (`reversal_of_id` pointing at the original), never by editing history.
 *
 * Relations:
 * - @ManyToOne → StudentWallet: the wallet this transaction belongs to
 */
@Entity('wallet_transactions')
@Index(['wallet_id', 'created_at'])
export class WalletTransaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => StudentWallet, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'wallet_id' })
  wallet: StudentWallet;

  @Column({ type: 'uuid' })
  wallet_id: string;

  /** Signed: positive = credit, negative = debit/reversal-of-credit. */
  @Column({ type: 'decimal', precision: 12, scale: 2 })
  amount: number;

  @Column({ type: 'enum', enum: WalletTransactionKind })
  kind: WalletTransactionKind;

  /** The payment that produced this movement (e.g. an overpayment credit). */
  @Column({ type: 'uuid', nullable: true })
  payment_id: string | null;

  /** The fee this movement was applied to or drawn from (e.g. a debit at checkout). */
  @Column({ type: 'uuid', nullable: true })
  student_fee_id: string | null;

  /** Set on a `REVERSAL` row: the original transaction it reverses (16.6.1). */
  @Column({ type: 'uuid', nullable: true })
  reversal_of_id: string | null;

  /** Null for a system-initiated movement (e.g. scheduled fee generation) that has no acting user. */
  @Column({ type: 'uuid', nullable: true })
  created_by_user_id: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  note: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
