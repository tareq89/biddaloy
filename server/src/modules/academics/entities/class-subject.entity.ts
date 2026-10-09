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
  Check,
} from 'typeorm';
import { School } from '../../schools/entities/school.entity';
import { Class } from './class.entity';
import { Subject } from './subject.entity';
import { AcademicYear } from './academic-year.entity';

/**
 * Which subjects a class offers in a given academic year.
 *
 * A class can offer the same subject across multiple academic years (a new
 * row each year, since the offering can change year to year), but never the
 * same (class, subject, academic year) twice.
 *
 * Relations:
 * - @ManyToOne → School: the tenant this offering belongs to
 * - @ManyToOne → Class: the class this subject is offered under
 * - @ManyToOne → Subject: the subject being offered
 * - @ManyToOne → AcademicYear: the year this offering applies to
 */
@Entity('class_subjects')
@Index(['tenant_id', 'academic_year_id'])
@Index(['class_id', 'subject_id', 'academic_year_id'], {
  unique: true,
  where: '"deleted_at" IS NULL',
})
// Mirrors the migration's CHK (see student-subject-choice.entity.ts note).
@Check(
  'CHK_class_subjects_choice_group_exclusive',
  `"choice_group" IS NULL OR (btrim("choice_group") <> '' AND "is_optional" = false AND "group_name" IS NULL)`,
)
export class ClassSubject {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => Class, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'class_id' })
  class: Class;

  @Column({ type: 'uuid' })
  class_id: string;

  @ManyToOne(() => Subject, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'subject_id' })
  subject: Subject;

  @Column({ type: 'uuid' })
  subject_id: string;

  // [20.1.1] Marks a subject that only ever gets a pass/fail-style
  // grade, never a numeric mark, and is excluded from GPA computation —
  // e.g. "Physical Education".
  @Column({ type: 'boolean', default: false })
  is_graded_only: boolean;

  @ManyToOne(() => AcademicYear, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'academic_year_id' })
  academic_year: AcademicYear;

  @Column({ type: 'uuid' })
  academic_year_id: string;

  @Column({ type: 'boolean', default: false })
  is_optional: boolean;

  /** #1266 validated against `organisation.groups`; NULL = not group-specific. */
  @Column({ type: 'varchar', length: 50, nullable: true })
  group_name: string | null;

  /** [35.1.7] 'Exactly one of' set within one class+year (D42). NULL = not in a choice group. Never with is_optional or group_name (DB CHECK). */
  @Column({ type: 'varchar', length: 50, nullable: true })
  choice_group: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;
}
