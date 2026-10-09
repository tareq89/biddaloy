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
import { Room } from '../../routines/entities/room.entity';

/**
 * [19.11.1] One subject's sitting within one exam — date, start/end time,
 * and an optional venue. Manually scheduled only; nothing here generates
 * or auto-assigns a schedule.
 *
 * `venue` was **deliberately free text**, not a FK to a future `rooms`
 * table (Epic 21.0, #918), until that table landed. [25.1.1] adds the
 * `room_id` FK this docstring always said would come additively: nullable,
 * `venue` kept as-is, backfilled from `venue` text where it confidently
 * matches a `rooms.room_no` (`1789800014000-SeatPlans` migration). Dropping
 * `venue` entirely is still a separate, later migration.
 *
 * Relations:
 * - @ManyToOne → School: tenant this schedule row belongs to
 * - @ManyToOne → Exam: the exam being scheduled
 * - @ManyToOne → Subject: the subject being scheduled
 * - @ManyToOne → Room: optional matched room (25.1.1)
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

  @ManyToOne(() => Room, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'room_id' })
  room: Room | null;

  @Column({ type: 'uuid', nullable: true })
  room_id: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;
}
