import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { School } from '../../schools/entities/school.entity';
import { AttendanceDevice } from './attendance-device.entity';
import { AttendanceRecord } from './attendance-record.entity';
import { Student } from '../../students/entities/student.entity';
import { AttendanceEventDirection } from '@biddaloy/shared';

/**
 * One raw scan a device sent — the forensic trail behind an
 * `AttendanceRecord`, kept even when the scan didn't produce or touch one
 * (`outcome` explains why).
 *
 * `(device_id, device_event_id)` is unique: a device retrying a batch
 * insert produces nothing new. This is the idempotency guarantee for
 * [9.5]'s ingestion endpoint.
 *
 * This table grows without bound; a retention job is deliberately out of
 * scope for this epic — noted in `docs/architecture/11-attendance.md`
 * ([9.11]).
 *
 * Relations:
 * - @ManyToOne → School: the tenant this event belongs to
 * - @ManyToOne → AttendanceDevice: device that sent this event
 * - @ManyToOne → AttendanceRecord (optional): the record it produced or
 *   touched
 */
@Entity('attendance_device_events')
@Index(['device_id', 'device_event_id'], { unique: true })
@Index(['tenant_id', 'occurred_at'])
export class AttendanceDeviceEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => AttendanceDevice, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'device_id' })
  device: AttendanceDevice;

  @Column({ type: 'uuid' })
  device_id: string;

  /** The device's own id for this scan. */
  @Column({ type: 'varchar', length: 100 })
  device_event_id: string;

  @ManyToOne(() => Student, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'student_id' })
  student: Student | null;

  @Column({ type: 'uuid', nullable: true })
  student_id: string | null;

  /** What the device sent when it had no resolvable `student_id`. */
  @Column({ type: 'varchar', length: 100, nullable: true })
  external_ref: string | null;

  @Column({ type: 'timestamptz' })
  occurred_at: Date;

  @Column({ type: 'enum', enum: AttendanceEventDirection })
  direction: AttendanceEventDirection;

  /** `accepted` / `duplicate` / `unknown_student` / `skipped_teacher_marked`
   * / `out_of_window` / `rejected`. */
  @Column({ type: 'varchar', length: 32 })
  outcome: string;

  @ManyToOne(() => AttendanceRecord, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'record_id' })
  record: AttendanceRecord | null;

  @Column({ type: 'uuid', nullable: true })
  record_id: string | null;

  /** Event as received, for forensics. */
  @Column({ type: 'jsonb', nullable: true })
  raw: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
