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
import { AttendanceSession } from './attendance-session.entity';
import { Student } from '../../students/entities/student.entity';
import { AttendanceDevice } from './attendance-device.entity';
import { AttendanceStatus, AttendanceSource } from '@biddaloy/shared';

/**
 * One student's mark within one `AttendanceSession`.
 *
 * `date` is denormalised from `session.date` on every write, never set
 * independently — the write path (owned by [9.3]) is the single place
 * that sets it, copying `session.date`. This is justified purely by
 * [9.4]'s per-student month summary (`WHERE tenant_id = ? AND
 * student_id = ? AND date BETWEEN ? AND ?`), which would otherwise force
 * a join to `attendance_sessions` on the hottest read in the epic.
 *
 * Two rules later tickets depend on:
 * 1. `source = 'TEACHER'` is never overwritten by a device event ([9.5]).
 * 2. `date` is always a copy of `session.date`, never written independently.
 *
 * Relations:
 * - @ManyToOne → School: the tenant this record belongs to
 * - @ManyToOne → AttendanceSession: the register this mark belongs to
 * - @ManyToOne → Student: who was marked
 * - @ManyToOne → AttendanceDevice (optional): device that produced this
 *   mark, when `source = 'DEVICE'`
 */
@Entity('attendance_records')
@Index(['session_id', 'student_id'], { unique: true })
@Index(['tenant_id', 'date', 'status'])
export class AttendanceRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => AttendanceSession, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'session_id' })
  session: AttendanceSession;

  @Column({ type: 'uuid' })
  session_id: string;

  @ManyToOne(() => Student, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'student_id' })
  student: Student;

  @Column({ type: 'uuid' })
  student_id: string;

  /** Copy of `session.date` — see docstring above. */
  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'enum', enum: AttendanceStatus })
  status: AttendanceStatus;

  /** Only meaningful when `status = LATE`. */
  @Column({ type: 'int', nullable: true })
  minutes_late: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  check_in_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  check_out_at: Date | null;

  @Column({ type: 'varchar', length: 280, nullable: true })
  remarks: string | null;

  @Column({ type: 'enum', enum: AttendanceSource, default: AttendanceSource.TEACHER })
  source: AttendanceSource;

  @ManyToOne(() => AttendanceDevice, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'device_id' })
  device: AttendanceDevice | null;

  @Column({ type: 'uuid', nullable: true })
  device_id: string | null;

  @Column({ type: 'uuid', nullable: true })
  recorded_by_user_id: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  recorded_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
