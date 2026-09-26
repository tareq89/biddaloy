import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  JoinColumn,
  ManyToOne,
  Index,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { School } from '../../schools/entities/school.entity';

/**
 * [36.1.1]/[36.2.1] Generic staff profile every staff `User`
 * (TEACHER/ADMIN/ACCOUNTANT/EXECUTIVE) gets — `employee_id`/`joining_date`
 * live here, not on the role-specific table, so attendance/leave (and any
 * future staff feature) can key off one row regardless of role. `Teacher`
 * keeps its own `employee_id` too (unchanged, unique globally) and points
 * at its `staff_profiles` row via `staff_profile_id`.
 *
 * Table created by migration `StaffAttendanceLeave1789800014000` — this
 * entity must match that schema exactly (see
 * `server/src/migrations/1789800014000-StaffAttendanceLeave.ts`).
 */
@Entity('staff_profiles')
@Index(['tenant_id'])
export class StaffProfile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @OneToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'uuid' })
  user_id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'varchar', length: 50 })
  employee_id: string;

  @Column({ type: 'date', nullable: true })
  joining_date: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
