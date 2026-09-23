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
import { User } from '../../users/entities/user.entity';
import { ChangeRequestState } from '@biddaloy/shared';

/**
 * A request to change a *published* `RoutineSlot` — e.g. a teacher asking
 * for a period to move — tracked separately from the slot itself so a
 * routine coordinator can accept or reject it without a teacher's request
 * silently mutating the live timetable.
 *
 * `resolved_by`/`resolved_at`/`resolution_note` stay `null` while
 * `state = 'OPEN'` and are all set together when the request is accepted
 * or rejected.
 *
 * D16: no cascading collection saves — this entity carries no
 * `@OneToMany` back-reference; `RoutinesModule` writes rows through
 * explicit repository calls, never `save()` on a parent carrying a
 * tenant-filtered collection.
 *
 * Relations:
 * - @ManyToOne → School: the tenant this request belongs to
 * - @ManyToOne → RoutineSlot: the scheduled class the request is about
 * - @ManyToOne → User (requested_by): who filed the request
 * - @ManyToOne → User (resolved_by, optional): who accepted/rejected it
 */
@Entity('routine_change_requests')
@Index(['tenant_id'])
@Index(['tenant_id', 'routine_slot_id'])
export class RoutineChangeRequest {
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

  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'requested_by' })
  requested_by_user: User;

  @Column({ type: 'uuid' })
  requested_by: string;

  @Column({ type: 'varchar', length: 500 })
  note: string;

  @Column({
    type: 'enum',
    enum: Object.values(ChangeRequestState),
    enumName: 'change_request_state_enum',
    default: ChangeRequestState.OPEN,
  })
  state: ChangeRequestState;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'resolved_by' })
  resolved_by_user: User | null;

  @Column({ type: 'uuid', nullable: true })
  resolved_by: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  resolved_at: Date | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  resolution_note: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
