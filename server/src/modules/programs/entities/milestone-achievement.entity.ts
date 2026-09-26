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
import { ProgramEnrollment } from './program-enrollment.entity';
import { ProgramMilestone } from './program-milestone.entity';
import { User } from '../../users/entities/user.entity';

/**
 * [34.1.3] A student's achievement of one `ProgramMilestone` within their
 * `ProgramEnrollment`. At most one row per (enrollment, milestone) — DB
 * unique constraint `UQ_milestone_achievements_enrollment_milestone`.
 * `score` is `numeric(6,2)` and `grade` is free-text `varchar(50)` (D21) —
 * this module doesn't compute or validate either against a grading scale.
 * Recording endpoints come in 34.2.1; this ticket only needs the entity so
 * `ProgramsService.removeMilestone` can report the achievement count
 * before the FK cascade deletes them (D23).
 *
 * Relations:
 * - @ManyToOne → School: tenant the achievement belongs to
 * - @ManyToOne → ProgramEnrollment: the enrollment it was recorded against
 * - @ManyToOne → ProgramMilestone: the milestone achieved
 * - @ManyToOne → User: staff member who recorded it (nullable — SET NULL
 *   if that user is later deleted)
 */
@Entity('milestone_achievements')
@Index(['tenant_id', 'enrollment_id'])
export class MilestoneAchievement {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => ProgramEnrollment, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'enrollment_id' })
  enrollment: ProgramEnrollment;

  @Column({ type: 'uuid' })
  enrollment_id: string;

  @ManyToOne(() => ProgramMilestone, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'milestone_id' })
  milestone: ProgramMilestone;

  @Column({ type: 'uuid' })
  milestone_id: string;

  @Column({ type: 'date' })
  achieved_on: string;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'recorded_by' })
  recorded_by_user: User | null;

  @Column({ type: 'uuid', nullable: true })
  recorded_by: string | null;

  @Column({ type: 'numeric', precision: 6, scale: 2, nullable: true })
  score: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  grade: string | null;

  @Column({ type: 'text', nullable: true })
  remark: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
