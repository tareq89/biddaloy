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
import { Student } from '../../students/entities/student.entity';
import { GradingScale } from '../../grading/entities/grading-scale.entity';

/**
 * [19.2.1] One student's computed result for one exam — the row a report
 * card is built from. `grading_scale_id` is pinned alongside
 * **`grading_scale_revision`** and **`rule_version`** (D19), following
 * `1789800008000-InvoiceImmutableSnapshot.ts`'s pinning approach: once
 * computed, a result records exactly which scale revision and rule
 * version produced it, so a later edit to the scale (Epic 20.0 D6 makes
 * scales editable, with editing triggering a recompute of dependent
 * results) cannot silently change what an already-printed card shows.
 * Comparing an old result's `grading_scale_revision` against the scale's
 * current `revision` is how a caller notices the card is stale and a
 * reprint would look different.
 *
 * Soft-deletable: a recompute soft-deletes the previous result row and
 * inserts a new one, the same pattern `grading_bands` uses for a scale
 * recompute — never an in-place mutation of a computed result.
 *
 * Relations:
 * - @ManyToOne → School: tenant this result belongs to
 * - @ManyToOne → Exam: the exam this result was computed for
 * - @ManyToOne → Student: whose result this is
 * - @ManyToOne → GradingScale: the scale this result was graded against
 * - Referenced-by → ResultSubject: this result's per-subject breakdown
 */
@Entity('results')
@Index(['tenant_id', 'exam_id'])
@Index(['exam_id', 'student_id'], { unique: true, where: '"deleted_at" IS NULL' })
export class Result {
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

  @Column({ type: 'numeric', precision: 8, scale: 2 })
  total_marks: string;

  @Column({ type: 'numeric', precision: 4, scale: 2 })
  gpa: string;

  @Column({ type: 'varchar', length: 10 })
  grade: string;

  @Column({ type: 'int', nullable: true })
  position: number | null;

  @Column({ type: 'boolean', default: false })
  is_fail: boolean;

  @ManyToOne(() => GradingScale, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'grading_scale_id' })
  grading_scale: GradingScale;

  @Column({ type: 'uuid' })
  grading_scale_id: string;

  /** The scale's `revision` at the moment this result was computed. */
  @Column({ type: 'int' })
  grading_scale_revision: number;

  /** Identifies which version of the NCTB rule engine produced this row. */
  @Column({ type: 'varchar', length: 50 })
  rule_version: string;

  @Column({ type: 'timestamptz' })
  computed_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  published_at: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;
}
