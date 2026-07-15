import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Unique,
} from 'typeorm';
import { Student } from '../../students/entities/student.entity';
import { AcademicYear } from '../../academics/entities/academic-year.entity';
import { FeeStatus } from '@beton-boi/shared';

@Entity('student_fees')
@Index(['student_id', 'academic_year_id', 'month', 'year'])
@Unique(['student_id', 'academic_year_id', 'month', 'year'])
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

  @Column({ type: 'int' })
  month: number;

  @Column({ type: 'int' })
  year: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  total_amount: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  paid_amount: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  discount_amount: number;

  @Column({ type: 'enum', enum: FeeStatus, default: FeeStatus.PENDING })
  status: FeeStatus;

  @Column({ type: 'date', nullable: true })
  due_date: Date | null;

  @Column({ type: 'date', nullable: true })
  reminder_threshold_date: Date | null;

  @Column({ type: 'boolean', default: false })
  is_advance_payment: boolean;

  @Column({ type: 'int', nullable: true })
  original_advance_month: number | null;

  @Column({ type: 'int', nullable: true })
  original_advance_year: number | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}