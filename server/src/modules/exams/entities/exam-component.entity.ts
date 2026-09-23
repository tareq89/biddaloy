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
import { School } from '../../schools/entities/school.entity';
import { Exam } from './exam.entity';
import { Subject } from '../../academics/entities/subject.entity';
import { ExamComponentKind, ExamComponentSource } from '@biddaloy/shared';

/**
 * [19.2.1] One markable part of one exam-subject — e.g. "Written" and
 * "MCQ" for the Physics exam component of a Term Exam. `full_marks`/
 * `pass_marks` are per component, not per subject, so a subject's total
 * is the sum of its components' `full_marks`.
 *
 * Deliberately **no `weight` column** (D16): every component contributes
 * its raw marks 1:1 to the subject total. A future ticket that needs
 * weighted components is a new decision, not a gap in this one.
 *
 * `source` marks where a component's marks come from: MANUAL (entered on
 * the marks grid) or DERIVED (computed server-side — currently only the
 * ATTENDANCE kind, D11). A DERIVED component never accepts direct grid
 * entry; that is enforced in the write path, not here.
 *
 * Relations:
 * - @ManyToOne → School: tenant this component belongs to
 * - @ManyToOne → Exam: the exam this component is part of
 * - @ManyToOne → Subject: the subject this component measures
 * - Referenced-by → Mark: entries against this component
 */
@Entity('exam_components')
@Index(['tenant_id', 'exam_id'])
@Index(['exam_id', 'subject_id', 'name'], { unique: true, where: '"deleted_at" IS NULL' })
export class ExamComponent {
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

  @ManyToOne(() => Subject, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'subject_id' })
  subject: Subject;

  @Column({ type: 'uuid' })
  subject_id: string;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'enum', enum: ExamComponentKind })
  kind: ExamComponentKind;

  @Column({ type: 'enum', enum: ExamComponentSource, default: ExamComponentSource.MANUAL })
  source: ExamComponentSource;

  @Column({ type: 'numeric', precision: 6, scale: 2 })
  full_marks: string;

  @Column({ type: 'numeric', precision: 6, scale: 2, nullable: true })
  pass_marks: string | null;

  @Column({ type: 'int' })
  sequence: number;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;
}
