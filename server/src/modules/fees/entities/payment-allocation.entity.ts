import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Payment } from './payment.entity';
import { StudentFee } from './student-fee.entity';
import { PaymentAllocationType } from '@beton-boi/shared';

/**
 * Tracks how a single payment is distributed across multiple fee periods.
 *
 * A single payment can cover multiple StudentFee records (e.g., paying
 * overdue fees from previous months + current month + advance). Each
 * allocation records how much of the payment went to which fee period
 * and the type of allocation (DUE, CURRENT, or ADVANCE).
 *
 * Relations:
 * - @ManyToOne → Payment: the parent payment transaction
 * - @ManyToOne → StudentFee: the specific month's fee being paid toward
 */
@Entity('payment_allocations')
@Index(['payment_id', 'student_fee_id'], { unique: true })
export class PaymentAllocation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Payment, (payment) => payment.allocations, { nullable: false })
  @JoinColumn({ name: 'payment_id' })
  payment: Payment;

  @Column({ type: 'uuid' })
  payment_id: string;

  @ManyToOne(() => StudentFee, { nullable: false })
  @JoinColumn({ name: 'student_fee_id' })
  student_fee: StudentFee;

  @Column({ type: 'uuid' })
  student_fee_id: string;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  allocated_amount: number;

  @Column({ type: 'enum', enum: PaymentAllocationType })
  allocation_type: PaymentAllocationType;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}