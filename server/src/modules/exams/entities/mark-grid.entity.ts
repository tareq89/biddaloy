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
import { Exam } from './exam.entity';
import { ClassSection } from '../../academics/entities/class-section.entity';
import { Subject } from '../../academics/entities/subject.entity';
import { MarkGridState } from '@biddaloy/shared';

/**
 * [19.2.1] D12 — one section-subject's marks-entry grid for one exam.
 * DRAFT is editable; SUBMITTED locks entry (subject to the exam's own
 * `ExamStatus`). The actual submit/reopen flow is a later ticket — this
 * entity only carries the state.
 *
 * Relations:
 * - @ManyToOne → School: tenant this grid belongs to
 * - @ManyToOne → Exam: the exam this grid entries marks for
 * - @ManyToOne → ClassSection: the section this grid covers
 * - @ManyToOne → Subject: the subject this grid covers
 */
@Entity('mark_grids')
@Index(['tenant_id', 'exam_id'])
@Index(['exam_id', 'section_id', 'subject_id'], { unique: true })
export class MarkGrid {
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

  @ManyToOne(() => ClassSection, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'section_id' })
  section: ClassSection;

  @Column({ type: 'uuid' })
  section_id: string;

  @ManyToOne(() => Subject, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'subject_id' })
  subject: Subject;

  @Column({ type: 'uuid' })
  subject_id: string;

  @Column({ type: 'enum', enum: MarkGridState, default: MarkGridState.DRAFT })
  state: MarkGridState;

  @Column({ type: 'uuid', nullable: true })
  submitted_by: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  submitted_at: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
