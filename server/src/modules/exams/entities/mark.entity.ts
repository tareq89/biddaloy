import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { School } from '../../schools/entities/school.entity';
import { Exam } from './exam.entity';
import { Student } from '../../students/entities/student.entity';
import { Subject } from '../../academics/entities/subject.entity';
import { ExamComponent } from './exam-component.entity';
import { MarkStatus } from '@biddaloy/shared';

/**
 * [19.2.1] One student's entered mark for one exam component.
 *
 * D10: `value` must be null whenever `status` is not PRESENT — an
 * `ABSENT` (or `EXEMPT`) mark must never be readable as a zero. This is
 * enforced by a database CHECK constraint in the migration
 * (`CHK_marks_value_only_when_present`), not left to application
 * convention, so a bug in a future write path cannot silently record a
 * zero for an absent student.
 *
 * No soft delete: a mark is either present or overwritten, never
 * "deleted" — the marks grid re-enters a component's row rather than
 * removing it.
 *
 * Relations:
 * - @ManyToOne → School: tenant this mark belongs to
 * - @ManyToOne → Exam: the exam this mark was entered for
 * - @ManyToOne → Student: who was marked
 * - @ManyToOne → Subject: the subject the component belongs to
 * - @ManyToOne → ExamComponent: the specific component this value is for
 */
@Entity('marks')
@Index(['tenant_id', 'exam_id'])
@Index(['exam_id', 'student_id', 'component_id'], { unique: true })
export class Mark {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => Exam, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'exam_id' })
  exam: Exam;

  @Column({ type: 'uuid' })
  exam_id: string;

  @ManyToOne(() => Student, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'student_id' })
  student: Student;

  @Column({ type: 'uuid' })
  student_id: string;

  @ManyToOne(() => Subject, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'subject_id' })
  subject: Subject;

  @Column({ type: 'uuid' })
  subject_id: string;

  @ManyToOne(() => ExamComponent, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'component_id' })
  component: ExamComponent;

  @Column({ type: 'uuid' })
  component_id: string;

  /** Null unless `status = PRESENT` — enforced by a DB check constraint. */
  @Column({ type: 'numeric', precision: 6, scale: 2, nullable: true })
  value: string | null;

  @Column({ type: 'enum', enum: MarkStatus })
  status: MarkStatus;

  @Column({ type: 'uuid', nullable: true })
  entered_by: string | null;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
