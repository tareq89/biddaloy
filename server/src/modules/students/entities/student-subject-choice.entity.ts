import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { School } from '../../schools/entities/school.entity';
import { Student } from './student.entity';
import { ClassSubject } from '../../academics/entities/class-subject.entity';
import { AcademicYear } from '../../academics/entities/academic-year.entity';

/**
 * [19.2.1] D14 — a student's fourth/optional subject choice. Per-student,
 * not per-class: D5's rule ("a student may offer one fourth subject") is
 * meaningless as a per-class flag, since two students in the same class
 * can pick different fourth subjects.
 *
 * `academic_year_id` is a denormalised copy of
 * `class_subject.academic_year_id`, the same reasoning as
 * `AttendanceRecord.date` copying `session.date`: the partial unique
 * index below needs "one `is_fourth = true` choice per student per
 * year" enforced at the database level, and a Postgres index cannot
 * reach through a FK into another table's column. The write path sets
 * it from the chosen `ClassSubject`, never independently.
 *
 * Relations:
 * - @ManyToOne → School: tenant this choice belongs to
 * - @ManyToOne → Student: whose choice this is
 * - @ManyToOne → ClassSubject: the subject offering chosen
 * - @ManyToOne → AcademicYear: denormalised year, see docstring above
 */
@Entity('student_subject_choices')
@Index(['tenant_id', 'student_id'])
@Index(['student_id', 'class_subject_id'], { unique: true })
// Mirrors the migration's own IDX_student_subject_choices_one_fourth_per_year
// (D14) — without this, TypeORM's schema builder sees no such partial
// index in entity metadata and drops it as "not declared".
@Index('IDX_student_subject_choices_one_fourth_per_year', ['student_id', 'academic_year_id'], {
  unique: true,
  where: '"is_fourth" = true',
})
export class StudentSubjectChoice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => Student, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'student_id' })
  student: Student;

  @Column({ type: 'uuid' })
  student_id: string;

  @ManyToOne(() => ClassSubject, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'class_subject_id' })
  class_subject: ClassSubject;

  @Column({ type: 'uuid' })
  class_subject_id: string;

  /** Denormalised from `class_subject.academic_year_id` — see docstring. */
  @ManyToOne(() => AcademicYear, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'academic_year_id' })
  academic_year: AcademicYear;

  @Column({ type: 'uuid' })
  academic_year_id: string;

  @Column({ type: 'boolean', default: false })
  is_fourth: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
