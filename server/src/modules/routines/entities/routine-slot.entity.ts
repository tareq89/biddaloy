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
import { ClassSection } from '../../academics/entities/class-section.entity';
import { Subject } from '../../academics/entities/subject.entity';
import { Routine } from './routine.entity';
import { PeriodSlot } from './period-slot.entity';
import { Room } from './room.entity';
import { SlotRecurrence } from '@biddaloy/shared';

/**
 * One scheduled class: this section, in this period slot, on this
 * weekday, teaching this subject — effective for the date range
 * `[valid_from, valid_to)` (`valid_to = null` means still in force).
 *
 * D4: no unique index on `(section_id, period_slot_id, weekday)`. Two
 * rows for the same section/period/weekday legitimately coexist with
 * disjoint date ranges — that's how a mid-year subject swap or a
 * substitution-turned-permanent change is represented, one row ending
 * where the next begins. Overlap between two *active* rows for the same
 * slot is enforced in `RoutinesModule`'s service layer, not the database.
 * Do not "fix" this by adding a unique index on those columns — it would
 * make effective dating impossible.
 *
 * `weekday` is `0`–`6`; the range is a table `CHECK` constraint added in
 * `1789800011000-AddRoutines` raw SQL (TypeORM's `@Column` decorator
 * has no range-check option).
 *
 * D16: no cascading collection saves — this entity carries no
 * `@OneToMany` back-reference to `RoutineSlotTeacher`; `RoutinesModule`
 * writes that join table through explicit repository calls, never
 * `save()` on a `RoutineSlot` carrying a tenant-filtered collection.
 *
 * Relations:
 * - @ManyToOne → School: the tenant this slot belongs to
 * - @ManyToOne → Routine: the timetable document this slot is part of
 * - @ManyToOne → ClassSection: the section being taught
 * - @ManyToOne → PeriodSlot: which grid cell (period, or break) this fills
 * - @ManyToOne → Subject: the subject being taught
 * - @ManyToOne → Room (optional): the fixed room, when one is assigned
 * - Referenced-by → RoutineSlotTeacher: teacher(s) assigned to this slot
 * - Referenced-by → RoutineSubstitution: dated overrides of this slot
 * - Referenced-by → RoutineChangeRequest: requested edits to this slot
 */
@Entity('routine_slots')
@Index(['tenant_id', 'section_id', 'weekday'])
@Index(['tenant_id', 'routine_id'])
export class RoutineSlot {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => Routine, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'routine_id' })
  routine: Routine;

  @Column({ type: 'uuid' })
  routine_id: string;

  @ManyToOne(() => ClassSection, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'section_id' })
  section: ClassSection;

  @Column({ type: 'uuid' })
  section_id: string;

  @ManyToOne(() => PeriodSlot, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'period_slot_id' })
  period_slot: PeriodSlot;

  @Column({ type: 'uuid' })
  period_slot_id: string;

  /** `0` = Sunday .. `6` = Saturday (Bangladesh school week). */
  @Column({ type: 'smallint' })
  weekday: number;

  @ManyToOne(() => Subject, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'subject_id' })
  subject: Subject;

  @Column({ type: 'uuid' })
  subject_id: string;

  @ManyToOne(() => Room, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'room_id' })
  room: Room | null;

  @Column({ type: 'uuid', nullable: true })
  room_id: string | null;

  @Column({ type: 'enum', enum: Object.values(SlotRecurrence) })
  recurrence: SlotRecurrence;

  /** Which occurrence in the `recurrence` cycle this slot falls on —
   * e.g. week 0 or week 1 of a `BIWEEKLY` slot. `0` for `WEEKLY`. */
  @Column({ type: 'smallint', default: 0 })
  recurrence_offset: number;

  @Column({ type: 'date' })
  valid_from: string;

  /** `null` = still in force. Postgres `date`, returned by TypeORM as a
   * plain string — see `Shift`'s docstring for the same `time`-column
   * caveat applied to `date`. */
  @Column({ type: 'date', nullable: true })
  valid_to: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
