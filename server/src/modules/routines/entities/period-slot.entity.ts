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
import { Shift } from './shift.entity';
import { PeriodSlotKind } from '@biddaloy/shared';

/**
 * One slot on a shift's timetable grid — "Period 1, 08:00–08:40", or a
 * `BREAK` slot ("Lunch", 12:00–12:30). `sequence` orders slots within
 * their shift; it is not derived from `starts_at` so slots can be
 * reordered without renumbering every row.
 *
 * `starts_at`/`ends_at` are Postgres `time` columns — TypeORM returns
 * them as a plain string, not a `Date` (see `Shift`'s docstring). The
 * `starts_at < ends_at` check is a table `CHECK` constraint, added in
 * `1789800011000-AddRoutines` raw SQL since TypeORM's `@Column` decorator
 * cannot express a cross-column check.
 *
 * No `deleted_at`: this ticket ([21.2.1]) gives period slots no
 * independent soft-delete lifecycle. Removing a period is a shift
 * structure edit — the row is FK-`CASCADE`d away with its `Shift`, or
 * replaced outright before any `routine_slots` reference it.
 *
 * D16: no cascading collection saves — this entity carries no
 * `@OneToMany` back-reference; `RoutinesModule` writes rows through
 * explicit repository calls, never `save()` on a parent carrying a
 * tenant-filtered collection.
 *
 * Relations:
 * - @ManyToOne → School: the tenant this slot belongs to
 * - @ManyToOne → Shift: the shift this slot's day window falls inside
 * - Referenced-by → RoutineSlot: `routine_slots.period_slot_id`, the
 *   scheduled class (or break) occupying this slot
 */
@Entity('period_slots')
@Index(['shift_id', 'sequence'], { unique: true })
@Index(['tenant_id'])
export class PeriodSlot {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => Shift, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'shift_id' })
  shift: Shift;

  @Column({ type: 'uuid' })
  shift_id: string;

  @Column({ type: 'smallint' })
  sequence: number;

  @Column({ type: 'enum', enum: Object.values(PeriodSlotKind), enumName: 'period_slot_kind_enum' })
  kind: PeriodSlotKind;

  /** e.g. "Lunch" for a `BREAK` slot. `null` for an ordinary class period. */
  @Column({ type: 'varchar', length: 50, nullable: true })
  name: string | null;

  @Column({ type: 'time' })
  starts_at: string;

  @Column({ type: 'time' })
  ends_at: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
