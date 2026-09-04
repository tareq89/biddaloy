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
import { ClassSection } from '../../academics/entities/class-section.entity';
import { Subject } from '../../academics/entities/subject.entity';
import { User } from '../../users/entities/user.entity';
import { AttendanceSessionState, AttendanceSource } from '@biddaloy/shared';

/**
 * One register — a section, on one school day, for one period (or the
 * whole day if `period_no` is null). Holds no marks itself; `AttendanceRecord`
 * rows hang off it, one per student.
 *
 * `date` is a Postgres `date` column, not `timestamptz` — "the 4th of
 * September" must not shift with timezone. TypeORM returns `date` columns
 * as a plain `'2026-09-04'` string, not a `Date`, so the field is typed
 * `string` here; treating it as a `Date` silently drifts by timezone.
 *
 * No `deleted_at`: a register is corrected, never deleted — [9.3] owns the
 * correction/audit-trail flow. `version` is a TypeORM `@VersionColumn`,
 * auto-incremented on every `save()`: [9.3] does the atomic conditional
 * update (matching `base_version` in the `WHERE` clause) and rejects a
 * write whose `base_version` doesn't match, firing [8.12.5]'s conflict
 * dialog.
 * `last_client_request_id` gives the same write replay idempotency — a
 * re-sent offline mutation carrying an id already stored against this
 * register writes nothing. This is the fix for the duplicate-write hole
 * documented in `ui/src/api/mutation-queue.ts`.
 *
 * The `(tenant_id, section_id, date, COALESCE(period_no, -1))` uniqueness
 * rule — two whole-day registers for one section on one day is
 * impossible — is a raw-SQL index in the `AddAttendance` migration, since
 * TypeORM's `@Index` decorator cannot express `COALESCE`.
 *
 * Relations:
 * - @ManyToOne → School: the tenant this session belongs to
 * - @ManyToOne → ClassSection: the section being marked
 * - @ManyToOne → Subject (optional): only meaningful for period-level
 *   attendance, unused until a later epic
 * - @ManyToOne → User (optional): who marked the register
 * - Referenced-by → AttendanceRecord: one row per student in this session
 */
@Entity('attendance_sessions')
@Index(['tenant_id', 'date'])
@Index(['section_id', 'date'])
export class AttendanceSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => ClassSection, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'section_id' })
  section: ClassSection;

  @Column({ type: 'uuid' })
  section_id: string;

  @Column({ type: 'date' })
  date: string;

  /** `null` = whole-day register. Period-level attendance is possible from
   * day one and unused until a later epic. */
  @Column({ type: 'smallint', nullable: true })
  period_no: number | null;

  @ManyToOne(() => Subject, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'subject_id' })
  subject: Subject | null;

  @Column({ type: 'uuid', nullable: true })
  subject_id: string | null;

  @Column({ type: 'enum', enum: AttendanceSessionState, default: AttendanceSessionState.DRAFT })
  state: AttendanceSessionState;

  @VersionColumn({ type: 'int', default: 1 })
  version: number;

  @Column({ type: 'enum', enum: AttendanceSource, default: AttendanceSource.TEACHER })
  source: AttendanceSource;

  @Column({ type: 'uuid', nullable: true })
  last_client_request_id: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'marked_by_user_id' })
  marked_by: User | null;

  @Column({ type: 'uuid', nullable: true })
  marked_by_user_id: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  marked_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  finalized_at: Date | null;

  /** When [9.8]'s auto-absent notification swept this session, for
   * dedupe — never sent twice for the same day. */
  @Column({ type: 'timestamptz', nullable: true })
  notified_at: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
