import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Check,
} from 'typeorm';
import { School } from '../../schools/entities/school.entity';
import { Student } from '../../students/entities/student.entity';
import { StudentFee } from '../../fees/entities/student-fee.entity';
import { Payment } from '../../fees/entities/payment.entity';
import { PaymentSubmission } from './payment-submission.entity';

/**
 * [3.x] A bill (student fee) a submission pays. FKs to `student_fees` and `payments` are
 * ON DELETE RESTRICT: a hard delete of either fails while a submission row points at it.
 * `payment_id` is filled at settlement (one Payment per student, D4).
 */
@Entity('payment_submission_bills')
@Check(
  'CHK_payment_submission_bills_amount',
  '"amount_at_start" > 0 AND "amount_at_start" <= 99999999.99',
)
@Index(['tenant_id'])
@Index(['student_fee_id'])
@Index(['submission_id', 'student_fee_id'], { unique: true })
export class PaymentSubmissionBill {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => PaymentSubmission, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'submission_id' })
  submission: PaymentSubmission;

  @Column({ type: 'uuid' })
  submission_id: string;

  @ManyToOne(() => StudentFee, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'student_fee_id' })
  student_fee: StudentFee;

  @Column({ type: 'uuid' })
  student_fee_id: string;

  @ManyToOne(() => Student, { nullable: false })
  @JoinColumn({ name: 'student_id' })
  student: Student;

  @Column({ type: 'uuid' })
  student_id: string;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  amount_at_start: number;

  @ManyToOne(() => Payment, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'payment_id' })
  payment: Payment | null;

  @Column({ type: 'uuid', nullable: true })
  payment_id: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
