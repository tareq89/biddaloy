import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  VersionColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { School } from '../../schools/entities/school.entity';

/**
 * [36.2.2] One tenant's staff attendance day — mirrors
 * `attendance-session.entity.ts` minus `section_id`/`subject_id`, since
 * staff have no section. Unlike the student register, staff attendance is
 * admin/self-marked rather than offline-queued, so there is no
 * `base_version` conflict dance on the write path — `version` still exists
 * (bumped on every correction, same as `AttendanceSession`) purely so a
 * future client can detect "this changed since I loaded it" cheaply if it
 * ever needs to.
 *
 * Table created by migration `StaffAttendanceLeave1789800014000` — this
 * entity must match that schema exactly.
 *
 * Relations:
 * - @ManyToOne → School: the tenant this session belongs to
 * - Referenced-by → StaffAttendanceRecord: one row per staff member marked
 */
@Entity('staff_attendance_sessions')
@Index(['tenant_id', 'date'], { unique: true })
export class StaffAttendanceSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  /** Postgres `date` column — TypeORM returns it as a plain
   * `'2026-09-04'` string, not a `Date`; see `AttendanceSession`'s own
   * docstring for why treating it as a `Date` silently drifts. */
  @Column({ type: 'date' })
  date: string;

  @VersionColumn({ type: 'int', default: 1 })
  version: number;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
