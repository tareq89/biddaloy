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
import { SeatPlan } from './seat-plan.entity';
import { ExamSchedule } from '../../exams/entities/exam-schedule.entity';

/**
 * [25.1.1] Join row: one `ExamSchedule` (subject sitting) that belongs to
 * one `SeatPlan`. The unique index on `(tenant_id, exam_schedule_id)`
 * (partial on `deleted_at IS NULL`, migration-level) backs D6's "an exam
 * schedule can't be in two plans at once" — but that constraint alone can't
 * see the *plan's* status, so the stronger "already in a PUBLISHED plan"
 * half of D6 is enforced in the service layer (#25.4), not here.
 *
 * Relations:
 * - @ManyToOne → School: tenant this row belongs to
 * - @ManyToOne → SeatPlan: the plan this schedule was added to
 * - @ManyToOne → ExamSchedule: the subject sitting being seated
 */
@Entity('seat_plan_schedules')
@Index(['tenant_id', 'seat_plan_id'])
export class SeatPlanSchedule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => SeatPlan, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'seat_plan_id' })
  seat_plan: SeatPlan;

  @Column({ type: 'uuid' })
  seat_plan_id: string;

  @ManyToOne(() => ExamSchedule, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'exam_schedule_id' })
  exam_schedule: ExamSchedule;

  @Column({ type: 'uuid' })
  exam_schedule_id: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;
}
