import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { StudentLifecycleEventType } from '@biddaloy/shared';
import { School } from '../../schools/entities/school.entity';
import { Student } from './student.entity';
import { Enrollment } from './enrollment.entity';
import { AcademicYear } from '../../academics/entities/academic-year.entity';

/**
 * [39.1.2] Append-only log of a student's enrolment-standing changes (D17, D20):
 * withdrawn, transferred out, graduated, readmitted. No `updated_at`, no soft delete.
 *
 * Relations:
 * - @ManyToOne → School: the tenant
 * - @ManyToOne → Student, Enrollment, AcademicYear: what changed and when
 */
@Entity('student_lifecycle_events')
@Index('IDX_student_lifecycle_events_tenant_student_date', [
  'tenant_id',
  'student_id',
  'occurred_on',
])
@Index('IDX_student_lifecycle_events_tenant_year_type', [
  'tenant_id',
  'academic_year_id',
  'event_type',
])
export class StudentLifecycleEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  student_id: string;

  @ManyToOne(() => Student, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'student_id' })
  student: Student;

  @Column({ type: 'uuid' })
  enrollment_id: string;

  @ManyToOne(() => Enrollment, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'enrollment_id' })
  enrollment: Enrollment;

  @Column({ type: 'uuid' })
  academic_year_id: string;

  @ManyToOne(() => AcademicYear, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'academic_year_id' })
  academic_year: AcademicYear;

  @Column({ type: 'enum', enum: StudentLifecycleEventType })
  event_type: StudentLifecycleEventType;

  @Column({ type: 'date' })
  occurred_on: string;

  @Column({ type: 'text' })
  reason: string;

  @Column({ type: 'text', nullable: true })
  destination: string | null;

  @Column({ type: 'text', nullable: true })
  remark: string | null;

  /** Null only for rows backfilled from pre-existing enrollments (D23). */
  @Column({ type: 'uuid', nullable: true })
  recorded_by_user_id: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
