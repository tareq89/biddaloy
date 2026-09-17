import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { RecurringSchedule } from './recurring-schedule.entity';
import { Student } from '../../students/entities/student.entity';
import { User } from '../../users/entities/user.entity';

/**
 * [16.7.1] One student carved out of a `RecurringSchedule`'s otherwise
 * class/section-matched `audience` — the schedule still lists the student
 * (flagged as excluded) on `GET /students/:id/schedules`, it just never
 * bills them.
 */
@Entity('recurring_schedule_exclusions')
@Index(['schedule_id', 'student_id'], { unique: true })
export class RecurringScheduleExclusion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => RecurringSchedule, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'schedule_id' })
  schedule: RecurringSchedule;

  @Column({ type: 'uuid' })
  schedule_id: string;

  @ManyToOne(() => Student, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'student_id' })
  student: Student;

  @Column({ type: 'uuid' })
  student_id: string;

  @Column({ type: 'text' })
  reason: string;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'created_by_user_id' })
  created_by: User | null;

  @Column({ type: 'uuid', nullable: true })
  created_by_user_id: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
