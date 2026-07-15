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

@Entity('payment_allocations')
@Index(['payment_id', 'student_fee_id'], { unique: true })
export class PaymentAllocation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Payment, (payment) => payment.allocations, { nullable: false, onDelete: 'CASCADE' })
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