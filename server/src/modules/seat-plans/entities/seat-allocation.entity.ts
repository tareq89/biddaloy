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
import { SeatPlan } from './seat-plan.entity';
import { ExamSchedule } from '../../exams/entities/exam-schedule.entity';
import { Student } from '../../students/entities/student.entity';
import { Room } from '../../routines/entities/room.entity';
import { User } from '../../users/entities/user.entity';

/**
 * [25.1.1] One student's seat for one subject sitting within one seat plan.
 * The unique index on `(tenant_id, seat_plan_id, exam_schedule_id,
 * student_id)` (migration-level) is the "one seat per student per
 * subject-sitting per plan" rule.
 *
 * `invigilator_user_id` is nullable (D8) — an allocation can exist before an
 * invigilator is assigned to the room/sitting.
 *
 * Relations:
 * - @ManyToOne → School: tenant this row belongs to
 * - @ManyToOne → SeatPlan: the plan this allocation was generated under
 * - @ManyToOne → ExamSchedule: the subject sitting being seated
 * - @ManyToOne → Student: the student seated
 * - @ManyToOne → Room: the room the seat is in
 * - @ManyToOne → User: the invigilator assigned to this seat/room (D8, optional)
 */
@Entity('seat_allocations')
@Index(['tenant_id', 'seat_plan_id', 'exam_schedule_id'])
export class SeatAllocation {
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

  @ManyToOne(() => Student, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'student_id' })
  student: Student;

  @Column({ type: 'uuid' })
  student_id: string;

  @ManyToOne(() => Room, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'room_id' })
  room: Room;

  @Column({ type: 'uuid' })
  room_id: string;

  @Column({ type: 'varchar', length: 20 })
  seat_number: string;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'invigilator_user_id' })
  invigilator: User | null;

  @Column({ type: 'uuid', nullable: true })
  invigilator_user_id: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
