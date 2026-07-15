import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Student } from '../../students/entities/student.entity';
import { StudentFee } from '../../fees/entities/student-fee.entity';
import { User } from '../../users/entities/user.entity';
import { InvoiceStatus } from '@beton-boi/shared';

@Entity('invoices')
@Index(['invoice_number'], { unique: true })
export class Invoice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 50, unique: true })
  invoice_number: string;

  @ManyToOne(() => Student, { nullable: false })
  @JoinColumn({ name: 'student_id' })
  student: Student;

  @Column({ type: 'uuid' })
  student_id: string;

  @ManyToOne(() => StudentFee, { nullable: true })
  @JoinColumn({ name: 'student_fee_id' })
  student_fee: StudentFee | null;

  @Column({ type: 'uuid', nullable: true })
  student_fee_id: string | null;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  total_amount: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  tax_amount: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  discount_amount: number;

  @Column({ type: 'enum', enum: InvoiceStatus, default: InvoiceStatus.DRAFT })
  status: InvoiceStatus;

  @Column({ type: 'date' })
  issued_date: Date;

  @Column({ type: 'date' })
  due_date: Date;

  @Column({ type: 'jsonb', nullable: true })
  line_items: Array<{
    description: string;
    amount: number;
    quantity: number;
    total: number;
  }> | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'issued_by_user_id' })
  issued_by: User | null;

  @Column({ type: 'uuid', nullable: true })
  issued_by_user_id: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;
}