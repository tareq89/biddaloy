import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  ManyToOne,
  JoinColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { Student } from '../../students/entities/student.entity';
import { User } from '../../users/entities/user.entity';
import { School } from '../../schools/entities/school.entity';
import { Invoice } from '../../invoices/entities/invoice.entity';
import { PaymentMethod, PaymentStatus } from '@beton-boi/shared';
import { PaymentAllocation } from './payment-allocation.entity';

/**
 * Records a financial transaction — fee payment collected from a student.
 *
 * A single payment can be split across multiple months/periods via
 * PaymentAllocation records (e.g., paying last month's due + current month
 * + advance). Supports manual recording (cash/cheque received by staff)
 * and future online payments. Each payment can optionally generate an invoice.
 *
 * Relations:
 * - @ManyToOne → Student: the student this payment is for
 * - @ManyToOne → School: the tenant this payment belongs to
 * - @ManyToOne → User (received_by): the staff member who collected the payment
 * - @ManyToOne → Invoice (optional): the generated invoice
 * - @OneToMany → PaymentAllocation: how this payment is split across fee periods
 */
@Entity('payments')
@Index(['student_id'])
@Index(['invoice_id'])
@Index(['created_at'])
export class Payment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Student, { nullable: false })
  @JoinColumn({ name: 'student_id' })
  student: Student;

  @Column({ type: 'uuid' })
  student_id: string;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  total_amount: number;

  @Column({ type: 'enum', enum: PaymentMethod })
  payment_method: PaymentMethod;

  @Column({ type: 'enum', enum: PaymentStatus, default: PaymentStatus.SUCCESS })
  payment_status: PaymentStatus;

  @Column({ type: 'varchar', length: 100, nullable: true })
  transaction_reference: string | null;

  @Column({ type: 'text', nullable: true })
  remarks: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'received_by_user_id' })
  received_by: User | null;

  @Column({ type: 'uuid', nullable: true })
  received_by_user_id: string | null;

  @ManyToOne(() => Invoice, { nullable: true })
  @JoinColumn({ name: 'invoice_id' })
  invoice: Invoice | null;

  @Column({ type: 'uuid', nullable: true })
  invoice_id: string | null;

  @OneToMany(() => PaymentAllocation, (alloc) => alloc.payment, { cascade: ['insert', 'update'] })
  allocations: PaymentAllocation[];

  @Column({ type: 'timestamptz' })
  payment_date: Date;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;
}