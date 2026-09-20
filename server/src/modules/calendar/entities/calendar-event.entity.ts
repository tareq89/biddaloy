import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
} from 'typeorm';
import { CalendarEventType, CalendarAudience } from '@biddaloy/shared';
import { School } from '../../schools/entities/school.entity';
import { AcademicYear } from '../../academics/entities/academic-year.entity';
import { CalendarEventClass } from './calendar-event-class.entity';

/**
 * A calendar entry — holiday, exam day, school event, meeting, or deadline
 * (17.x). [9.4]'s working-day math reads this to compute attendance
 * denominators. Renamed from `SchoolHoliday`/`school_holidays` in [17.1.2]
 * to reflect the wider set of event `type`s the calendar module owns; the
 * old holiday-only rows are preserved with `type = 'HOLIDAY'`.
 *
 * `start_date`/`end_date` is an inclusive range; a one-day event sets both
 * the same. The migration keeps `CHECK ("start_date" <= "end_date")` and
 * adds `CHECK (start_time IS NULL OR end_time IS NULL OR start_time <= end_time)`.
 *
 * `counts_as_working_day` exists because not every calendar entry removes
 * a day from the denominator — an exam day or a school event is on the
 * calendar but *is* a working day.
 *
 * `published_at` is null for a draft event. [17.1.2] D9: a draft never
 * affects working-day math or attendance — only a published event does.
 *
 * Relations:
 * - @ManyToOne → School: the tenant this event belongs to
 * - @ManyToOne → AcademicYear: the year this event falls within
 * - @OneToMany → CalendarEventClass: which classes this event targets, if scoped
 */
@Entity('calendar_events')
@Index(['tenant_id', 'start_date', 'end_date'])
export class CalendarEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => AcademicYear, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'academic_year_id' })
  academic_year: AcademicYear;

  @Column({ type: 'uuid' })
  academic_year_id: string;

  @Column({ type: 'varchar', default: CalendarEventType.HOLIDAY })
  type: CalendarEventType;

  @Column({ type: 'date' })
  start_date: string;

  @Column({ type: 'date' })
  end_date: string;

  @Column({ type: 'time', nullable: true })
  start_time: string | null;

  @Column({ type: 'time', nullable: true })
  end_time: string | null;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'boolean', default: false })
  counts_as_working_day: boolean;

  @Column({ type: 'varchar', default: CalendarAudience.ALL })
  audience: CalendarAudience;

  /** Null while the event is a draft. A draft never removes a working day
   * and is never notified/exported (D9). */
  @Column({ type: 'timestamptz', nullable: true })
  published_at: Date | null;

  /** External source references (e.g. a public-holiday import row, a
   * Google Calendar event id) — opaque to this module's own logic. */
  @Column({ type: 'jsonb', default: {} })
  external_refs: Record<string, unknown>;

  @Column({ type: 'uuid', nullable: true })
  created_by_user_id: string | null;

  @Column({ type: 'uuid', nullable: true })
  updated_by_user_id: string | null;

  @OneToMany(() => CalendarEventClass, (link) => link.event)
  classes: CalendarEventClass[];

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;
}
