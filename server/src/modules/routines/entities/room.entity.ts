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
 * A physical room a class can be scheduled into (e.g. "Building A, 204").
 *
 * `building` is nullable — a small school may have one building and never
 * name it. The `(tenant_id, building, room_no)` uniqueness uses
 * `NULLS NOT DISTINCT` (raw SQL in `1789800011000-AddRoutines`, partial on
 * `deleted_at IS NULL`) so two rooms both numbered "204" with no building
 * set collide as duplicates, the same problem `classes`' nullable
 * `shift`/`version` columns solved in `AddOrganisationDimensions`
 * (`class.entity.ts` documents why — plain Postgres uniqueness treats
 * `NULL` as distinct from itself, which would silently let duplicates
 * through). TypeORM's `@Index` decorator cannot express `NULLS NOT
 * DISTINCT`, so the migration, not this decorator, is the schema's source
 * of truth for this index.
 *
 * D16: no cascading collection saves — this entity carries no
 * `@OneToMany` back-reference; `RoutinesModule` writes rows through
 * explicit repository calls, never `save()` on a parent carrying a
 * tenant-filtered collection.
 *
 * Relations:
 * - @ManyToOne → School: the tenant this room belongs to
 * - Referenced-by → RoutineSlot: `routine_slots.room_id` (nullable — not
 *   every scheduled class needs a fixed room)
 */
@Entity('rooms')
@Index(['tenant_id'])
export class Room {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  building: string | null;

  @Column({ type: 'varchar', length: 50 })
  room_no: string;

  @Column({ type: 'int', nullable: true })
  capacity: number | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;
}
