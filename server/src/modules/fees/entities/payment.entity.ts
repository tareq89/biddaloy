import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { Student } from '../../students/entities/student.entity';
import { User } from '../../users/entities/user.entity';
import { Invoice } from '../../invoices/entities/invoice.entity';
import { PaymentMethod, PaymentStatus } from '@beton-boi/shared';
import { PaymentAllocation } from './payment-allocation.entity';

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

  @OneToMany(() => PaymentAllocation, (alloc) => alloc.payment, { cascade: true })
  allocations: PaymentAllocation[];

  @Column({ type: 'timestamptz' })
  payment_date: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}