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
import { RoutineSlot } from './routine-slot.entity';
import { Teacher } from '../../academics/entities/teacher.entity';
import { User } from '../../users/entities/user.entity';

/**
 * A dated override of a `RoutineSlot` — "on this one date, this period
 * either has a substitute teacher or is cancelled outright" — without
 * touching the slot's own effective-dated row (D12). One row per
 * `(routine_slot_id, date)`.
 *
 * `is_cancelled` and `substitute_teacher_id` are independent: a cancelled
 * period has no substitute; a covered period has one and is not
 * cancelled. The pair is not modeled as a two-value enum because a period
 * that is neither is simply not represented by a row at all — this table
 * only holds days that differ from the routine.
 *
 * No `deleted_at`: correcting a substitution updates `is_cancelled` /
 * `substitute_teacher_id` / `reason` in place (like `AttendanceSession`,
 * which is corrected, never deleted) rather than soft-deleting and
 * re-creating.
 *
 * D16: no cascading collection saves — this entity carries no
 * `@OneToMany` back-reference; `RoutinesModule` writes rows through
 * explicit repository calls, never `save()` on a parent carrying a
 * tenant-filtered collection.
 *
 * Relations:
 * - @ManyToOne → School: the tenant this substitution belongs to
 * - @ManyToOne → RoutineSlot: the scheduled class being overridden
 * - @ManyToOne → Teacher (optional): the substitute teacher, when covered
 * - @ManyToOne → User: who created this substitution record
 */
@Entity('routine_substitutions')
@Index(['routine_slot_id', 'date'], { unique: true })
@Index(['tenant_id'])
export class RoutineSubstitution {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => RoutineSlot, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'routine_slot_id' })
  routine_slot: RoutineSlot;

  @Column({ type: 'uuid' })
  routine_slot_id: string;

  @Column({ type: 'date' })
  date: string;

  @ManyToOne(() => Teacher, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'substitute_teacher_id' })
  substitute_teacher: Teacher | null;

  @Column({ type: 'uuid', nullable: true })
  substitute_teacher_id: string | null;

  @Column({ type: 'boolean', default: false })
  is_cancelled: boolean;

  @Column({ type: 'varchar', length: 280, nullable: true })
  reason: string | null;

  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'created_by' })
  created_by_user: User;

  @Column({ type: 'uuid' })
  created_by: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
