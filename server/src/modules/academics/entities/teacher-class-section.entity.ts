import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Teacher } from '../../academics/entities/teacher.entity';
import { ClassSection } from '../../academics/entities/class-section.entity';
import { School } from '../../schools/entities/school.entity';
import { Subject } from './subject.entity';

/**
 * Junction table linking a Teacher to the ClassSections they are assigned
 * to. A teacher can be assigned to multiple sections, and a section can
 * have multiple teachers (e.g., subject teachers).
 *
 * `subject_id IS NULL` means a class-teacher / whole-day assignment;
 * a non-null `subject_id` means this row is that teacher's assignment as
 * the subject teacher for that section.
 *
 * The `(teacher_id, section_id, subject_id)` unique index below does not
 * by itself prevent a teacher being attached twice to the same section
 * with `subject_id = NULL` — Postgres treats NULLs as distinct values in a
 * unique index. A second, partial unique index
 * (`UQ_tcs_teacher_section_no_subject`) enforcing that case lives in the
 * `AddSubjectsAndClassSubjects` migration (raw SQL, since TypeORM's
 * `@Index` decorator cannot express a `WHERE subject_id IS NULL` partial
 * index alongside a non-partial one on overlapping columns).
 *
 * Relations:
 * - @ManyToOne → Teacher: the teacher
 * - @ManyToOne → ClassSection: the section they teach
 * - @ManyToOne → School: the tenant this assignment belongs to
 * - @ManyToOne → Subject: the subject taught, when this is a subject-teacher
 *   assignment
 */
@Entity('teacher_class_sections')
@Index(['teacher_id', 'section_id', 'subject_id'], { unique: true })
export class TeacherClassSection {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Teacher, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'teacher_id' })
  teacher: Teacher;

  @Column({ type: 'uuid' })
  teacher_id: string;

  @ManyToOne(() => ClassSection, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'section_id' })
  section: ClassSection;

  @Column({ type: 'uuid' })
  section_id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => Subject, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'subject_id' })
  subject: Subject | null;

  @Column({ type: 'uuid', nullable: true })
  subject_id: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
