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

/**
 * [19.11.1] One subject's sitting within one exam — date, start/end time,
 * and an optional venue. Manually scheduled only; nothing here generates
 * or auto-assigns a schedule.
 *
 * `venue` is **deliberately free text**, not a FK to a future `rooms`
 * table (Epic 21.0, #918). That epic's merge order relative to this one
 * isn't fixed, and coupling this table to an unlanded `rooms` table would
 * block whichever epic lands second. Moving to a `room_id` later is
 * additive: add a nullable `room_id` FK alongside `venue`, backfill by
 * matching text to room names, then drop `venue` in its own migration —
 * this table doesn't need to change shape today to allow that path.
 *
 * Relations:
 * - @ManyToOne → School: tenant this schedule row belongs to
 * - @ManyToOne → Exam: the exam being scheduled
 * - @ManyToOne → Subject: the subject being scheduled
 */
@Entity('exam_schedules')
@Index(['tenant_id', 'exam_id'])
@Index(['exam_id', 'subject_id'], { unique: true, where: '"deleted_at" IS NULL' })
export class ExamSchedule {
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

  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'time' })
  starts_at: string;

  @Column({ type: 'time' })
  ends_at: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  venue: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;
}
