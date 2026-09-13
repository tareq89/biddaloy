import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  ManyToOne,
  JoinColumn,
  Check,
  Index,
} from 'typeorm';
import { Student } from '../../students/entities/student.entity';
import { AcademicYear } from '../../academics/entities/academic-year.entity';
import { FeeStructure } from './fee-structure.entity';
import { FeeStatus, PeriodType } from '@biddaloy/shared';

/**
 * One bill: a single student owing a single fee structure for a single
 * period (e.g. "Karim, Tuition, March 2026"). `month`/`year` are stored
 * generated columns derived from `period_start` — every existing
 * month/year filter keeps working unchanged (16.1.3, D2).
 *
 * `occurrence` distinguishes multiple bills for the same
 * (student, fee_structure, period) — e.g. a late fee re-billed after a
 * DuplicateStrategy.CREATE_ANYWAY run — and is part of the unique key.
 *
 * `discount_amount` is always the sum of `standing_discount_amount` (from
 * a recurring FeeStructureDiscount) and `one_off_discount_amount` (applied
 * to this bill only) — enforced by a CHECK constraint at the DB level.
 *
 * Payments are allocated against these records (via PaymentAllocation),
 * updating paid_amount and status (PENDING → PARTIALLY_PAID → PAID).
 *
 * Relations:
 * - @ManyToOne → Student: the student this bill belongs to
 * - @ManyToOne → AcademicYear: the academic year
 * - @ManyToOne → FeeStructure: the fee template this bill was generated from
 * - Referenced-by → PaymentAllocation: how payments are split across bills
 * - Referenced-by → Invoice: invoices reference the fee being paid
 * - Referenced-by → StudentFee (self, `late_fee_for_student_fee_id`): a late
 *   fee bill links back to the original bill it was charged against
 */
@Entity('student_fees')
@Index(['student_id', 'fee_structure_id', 'period_start', 'occurrence'], {
  unique: true,
  where: '"deleted_at" IS NULL',
})
@Check('"month" BETWEEN 1 AND 12')
@Check('"year" > 0')
@Check('total_amount > 0')
@Check('discount_amount = standing_discount_amount + one_off_discount_amount')
@Index(['period_start'])
@Index(['fee_generation_id'])
export class StudentFee {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Student, { nullable: false })
  @JoinColumn({ name: 'student_id' })
  student: Student;

  @Column({ type: 'uuid' })
  student_id: string;

  @ManyToOne(() => AcademicYear, { nullable: false })
  @JoinColumn({ name: 'academic_year_id' })
  academic_year: AcademicYear;

  @Column({ type: 'uuid' })
  academic_year_id: string;

  @ManyToOne(() => FeeStructure, { nullable: false })
  @JoinColumn({ name: 'fee_structure_id' })
  fee_structure: FeeStructure;

  @Column({ type: 'uuid' })
  fee_structure_id: string;

  /**
   * FK added in 16.1.4's migration, not here — this ticket only declares
   * the column so 16.1.3 and 16.1.4 can land independently in the same wave.
   */
  @Column({ type: 'uuid', nullable: true })
  fee_generation_id: string | null;

  @Column({ type: 'date' })
  period_start: Date;

  @Column({ type: 'enum', enum: PeriodType, default: PeriodType.MONTH })
  period_type: PeriodType;

  /**
   * Distinguishes multiple bills for the same (student, fee_structure,
   * period) — part of the unique key alongside those three columns.
   */
  @Column({ type: 'int', default: 1 })
  occurrence: number;

  /**
   * Stored generated columns derived from `period_start`, kept so every
   * pre-existing month/year filter and query keeps working unchanged.
   */
  @Column({
    type: 'int',
    generatedType: 'STORED',
    asExpression: 'EXTRACT(MONTH FROM period_start)::int',
  })
  month: number;

  @Column({
    type: 'int',
    generatedType: 'STORED',
    asExpression: 'EXTRACT(YEAR FROM period_start)::int',
  })
  year: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  total_amount: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  paid_amount: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  discount_amount: number;

  /** Portion of `discount_amount` coming from a recurring/standing discount. */
  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  standing_discount_amount: number;

  /** Portion of `discount_amount` applied to this bill only. */
  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  one_off_discount_amount: number;

  @Column({ type: 'enum', enum: FeeStatus, default: FeeStatus.PENDING })
  status: FeeStatus;

  @Column({ type: 'date', nullable: true })
  due_date: Date | null;

  @Column({ type: 'date', nullable: true })
  reminder_threshold_date: Date | null;

  @Column({ type: 'uuid', nullable: true })
  approved_by_user_id: string | null;

  /**
   * Self-FK (D11): when set, this bill IS a late fee charged against the
   * bill it points to. A partial unique index (declared in the migration,
   * not here — TypeORM has no `WHERE` clause on `@Index`) enforces one
   * late fee per original bill.
   */
  @Column({ type: 'uuid', nullable: true })
  late_fee_for_student_fee_id: string | null;

  @ManyToOne(() => StudentFee, { nullable: true })
  @JoinColumn({ name: 'late_fee_for_student_fee_id' })
  late_fee_for_student_fee: StudentFee | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'timestamptz' })
  deleted_at: Date | null;
}
