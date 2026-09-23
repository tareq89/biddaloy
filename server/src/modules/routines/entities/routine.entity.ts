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
import { AcademicYear } from '../../academics/entities/academic-year.entity';
import { RoutineState } from '@biddaloy/shared';

/**
 * One timetable document for a tenant's academic year. `state` tracks its
 * lifecycle: `DRAFT` while being built, `REVIEW` while awaiting sign-off,
 * `PUBLISHED` — `published_at` set — once it is what students, guardians
 * and teachers see.
 *
 * One routine per `(tenant_id, academic_year_id)` — the unique index is
 * partial on `deleted_at IS NULL` so a soft-deleted routine (e.g. a draft
 * abandoned and restarted) doesn't block a fresh one for the same year.
 *
 * D16: no cascading collection saves — this entity carries no
 * `@OneToMany` back-reference to `RoutineSlot`; `RoutinesModule` writes
 * `routine_slots` rows through explicit repository calls, never `save()`
 * on a `Routine` carrying a tenant-filtered collection.
 *
 * Relations:
 * - @ManyToOne → School: the tenant this routine belongs to
 * - @ManyToOne → AcademicYear: the year this routine covers
 * - Referenced-by → RoutineSlot: the scheduled classes making up this
 *   routine's timetable grid
 */
@Entity('routines')
@Index(['tenant_id', 'academic_year_id'], { unique: true, where: '"deleted_at" IS NULL' })
@Index(['tenant_id'])
export class Routine {
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

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({
    type: 'enum',
    enum: Object.values(RoutineState),
    enumName: 'routine_state_enum',
    default: RoutineState.DRAFT,
  })
  state: RoutineState;

  @Column({ type: 'timestamptz', nullable: true })
  published_at: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;
}
