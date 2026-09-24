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
import { RoutineSlot } from './routine-slot.entity';
import { Teacher } from '../../academics/entities/teacher.entity';

/**
 * Junction table: which teacher(s) cover a `RoutineSlot`. Usually one, but
 * co-taught periods need more than one row per slot.
 *
 * The `(tenant_id, teacher_id)` index (D15) is what a "show me this
 * teacher's week" read uses — scanning every slot a teacher is assigned
 * to, tenant-scoped, without joining back through every section.
 *
 * No `deleted_at`: a plain join row, like `TeacherClassSection` — removing
 * a teacher from a slot deletes the row outright rather than soft-deleting
 * it.
 *
 * D16: no cascading collection saves — this entity is itself the child
 * side of the no-`@OneToMany` rule on `RoutineSlot`; `RoutinesModule`
 * writes rows here through explicit repository calls, never by saving a
 * `RoutineSlot` with a collection attached.
 *
 * Relations:
 * - @ManyToOne → School: the tenant this assignment belongs to
 * - @ManyToOne → RoutineSlot: the scheduled class being covered
 * - @ManyToOne → Teacher: the teacher covering it
 */
@Entity('routine_slot_teachers')
@Index(['routine_slot_id', 'teacher_id'], { unique: true })
@Index(['tenant_id', 'teacher_id'])
export class RoutineSlotTeacher {
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

  @ManyToOne(() => Teacher, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'teacher_id' })
  teacher: Teacher;

  @Column({ type: 'uuid' })
  teacher_id: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
