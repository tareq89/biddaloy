import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { School } from '../../schools/entities/school.entity';

/**
 * A tenant's named daily shift (e.g. "Morning", "Day") — the day window a
 * timetable's periods are laid out inside.
 *
 * [21.2.1] promotes `classes.shift` (a free-text column) to this table:
 * `1789800011000-AddRoutines`'s `up()` does
 * `INSERT INTO shifts (tenant_id, name) SELECT DISTINCT tenant_id, shift
 * FROM classes WHERE shift IS NOT NULL` (Epic 33.0 D10), then backfills
 * `classes.shift_id` by matching name. `classes.shift` (the string column)
 * is kept for one release after this — not dropped in the same
 * migration — so there is a rollback path if the backfill is wrong; a
 * follow-up ticket drops it.
 *
 * `day_starts_at`/`day_ends_at` are Postgres `time` columns — TypeORM
 * returns them as a plain `'08:00:00'` string, not a `Date`; treating them
 * as a `Date` silently drifts by timezone (same caveat as `date` columns,
 * see `AttendanceSession`'s docstring).
 *
 * D16: **no cascading collection saves.** This entity carries no
 * `@OneToMany` back-reference to `PeriodSlot` on purpose — `RoutinesModule`
 * writes `period_slots` rows through its own repository, one call at a
 * time. This codebase has hit a real bug from the alternative: calling
 * `save()` on a parent entity that carries a tenant-filtered `OneToMany`
 * collection silently NULLs out other tenants' rows on the far side of
 * that relation — TypeORM diffs the *whole* collection against what's on
 * disk, and a tenant-scoped query only ever loaded a subset of it.
 *
 * Relations:
 * - @ManyToOne → School: the tenant this shift belongs to
 * - Referenced-by → PeriodSlot: periods laid out within this shift's day
 * - Referenced-by → Class: `classes.shift_id`, backfilled from this table
 */
@Entity('shifts')
@Index(['tenant_id', 'name'], { unique: true, where: '"deleted_at" IS NULL' })
@Index(['tenant_id'])
export class Shift {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'time' })
  day_starts_at: string;

  @Column({ type: 'time' })
  day_ends_at: string;

  @Column({ type: 'smallint' })
  sequence: number;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;
}
