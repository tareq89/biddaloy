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
import { StaffAttendanceSession } from './staff-attendance-session.entity';
import { StaffProfile } from '../../staff-profiles/entities/staff-profile.entity';
import { AttendanceStatus, AttendanceSource } from '@biddaloy/shared';

/**
 * [36.2.2] One staff member's mark within one `StaffAttendanceSession`.
 * Reuses the same `attendance_status_enum`/`attendance_source_enum` types
 * as `AttendanceRecord` — see the migration's docstring.
 *
 * Unlike `AttendanceRecord`, this has no time-based auto-status for v1:
 * `status` is always a direct pick by the caller (admin or the staff
 * member themselves), not derived from `check_in_at`/`check_out_at`
 * against a policy window.
 *
 * Relations:
 * - @ManyToOne → School: the tenant this record belongs to
 * - @ManyToOne → StaffAttendanceSession: the day this mark belongs to
 * - @ManyToOne → StaffProfile: who was marked
 */
@Entity('staff_attendance_records')
@Index(['session_id', 'staff_profile_id'], { unique: true })
export class StaffAttendanceRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => StaffAttendanceSession, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'session_id' })
  session: StaffAttendanceSession;

  @Column({ type: 'uuid' })
  session_id: string;

  @ManyToOne(() => StaffProfile, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'staff_profile_id' })
  staff_profile: StaffProfile;

  @Column({ type: 'uuid' })
  staff_profile_id: string;

  @Column({ type: 'enum', enum: AttendanceStatus })
  status: AttendanceStatus;

  @Column({ type: 'enum', enum: AttendanceSource, default: AttendanceSource.TEACHER })
  source: AttendanceSource;

  @Column({ type: 'timestamptz', nullable: true })
  check_in_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  check_out_at: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
