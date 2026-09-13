import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Unique,
  Check,
  Index,
} from 'typeorm';
import { Student } from '../../students/entities/student.entity';
import { School } from '../../schools/entities/school.entity';

/**
 * A per-student credit balance (16.1.5).
 *
 * One row per student per tenant, created lazily on first credit/debit by
 * `WalletService.getOrCreate`. `balance` is the only mutable column — every
 * change to it is also recorded, in the same transaction, as an append-only
 * `WalletTransaction` row (see that entity's docstring). Consumers:
 * checkout (16.4.2) debits it, fee-generation auto-apply (16.3.1) credits/
 * debits it, and reversal (16.6.1) reverses a prior transaction.
 *
 * Relations:
 * - @ManyToOne → Student: the student this wallet belongs to
 * - @ManyToOne → School: the tenant this wallet belongs to
 * - Referenced-by → WalletTransaction: the append-only ledger of balance moves
 */
@Entity('student_wallets')
@Unique('UQ_student_wallets_tenant_student', ['tenant_id', 'student_id'])
@Check('CHK_sw_balance_non_negative', '"balance" >= 0')
export class StudentWallet {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Index()
  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => Student, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'student_id' })
  student: Student;

  @Column({ type: 'uuid' })
  student_id: string;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  balance: number;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
