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
import { Result } from './result.entity';
import { Subject } from '../../academics/entities/subject.entity';

/**
 * [19.2.1] One subject's line within a `Result` — the per-subject
 * breakdown a report card prints. `is_fourth_subject` marks a subject
 * that counted as the student's fourth/optional subject for this result
 * (D14's per-student choice, `StudentSubjectChoice`, decides which
 * subject that is; this column just records the outcome for this exam).
 *
 * Soft-deletable in lockstep with its parent `Result` — a recompute
 * replaces a result's whole subject breakdown, not individual lines.
 *
 * Relations:
 * - @ManyToOne → School: tenant this line belongs to
 * - @ManyToOne → Result: the result this subject line belongs to
 * - @ManyToOne → Subject: the subject this line is for
 */
@Entity('result_subjects')
@Index(['tenant_id', 'result_id'])
@Index(['result_id', 'subject_id'], { unique: true, where: '"deleted_at" IS NULL' })
export class ResultSubject {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => Result, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'result_id' })
  result: Result;

  @Column({ type: 'uuid' })
  result_id: string;

  @ManyToOne(() => Subject, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'subject_id' })
  subject: Subject;

  @Column({ type: 'uuid' })
  subject_id: string;

  @Column({ type: 'numeric', precision: 6, scale: 2 })
  obtained: string;

  @Column({ type: 'varchar', length: 10 })
  grade: string;

  @Column({ type: 'numeric', precision: 4, scale: 2 })
  gpa: string;

  @Column({ type: 'boolean', default: false })
  is_fail: boolean;

  @Column({ type: 'boolean', default: false })
  is_fourth_subject: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;
}
