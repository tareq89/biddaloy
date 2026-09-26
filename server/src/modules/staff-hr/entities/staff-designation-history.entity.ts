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
import { User } from '../../users/entities/user.entity';
import { Designation } from './designation.entity';
import { StaffEmploymentStatus } from '@biddaloy/shared';

/**
 * One entry in a staff member's designation/employment-status history.
 *
 * At most one open row (`end_date IS NULL`) per `(tenant_id, user_id)` —
 * the current designation for that user in that tenant (a user can work in
 * more than one tenant/branch) — enforced by a partial unique index. Kept
 * here as `@Index(..., { where })`, same pattern as `Designation`'s
 * `(tenant_id, title_en)` index, so TypeORM's own metadata matches the
 * migration (`1789800014000-staff-hr-core.ts`'s
 * `UQ_staff_designation_history_open_row`) and `migration:generate` doesn't
 * try to drop it. The migration is still the source of truth for the DB
 * object; this annotation exists only so schema diffing doesn't fight it.
 * `promote()` (staff-hr.service.ts) never updates a row in place: it closes
 * the current open row (sets `end_date`) and inserts a new one, in one
 * transaction.
 *
 * `resigned_at` is entity-only (not on `StaffDesignationHistoryDto`, 23.1)
 * — set internally when `status` transitions to `RESIGNED`, never accepted
 * as external input.
 */
@Entity('staff_designation_history')
@Index(['tenant_id'])
@Index(['user_id'])
@Index(['tenant_id', 'user_id'], { unique: true, where: '"end_date" IS NULL' })
export class StaffDesignationHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'uuid' })
  user_id: string;

  @ManyToOne(() => Designation, { nullable: false })
  @JoinColumn({ name: 'designation_id' })
  designation: Designation;

  @Column({ type: 'uuid' })
  designation_id: string;

  @Column({ type: 'date' })
  effective_date: Date;

  @Column({ type: 'date', nullable: true })
  end_date: Date | null;

  @Column({ type: 'enum', enum: StaffEmploymentStatus })
  status: StaffEmploymentStatus;

  @Column({ type: 'timestamptz', nullable: true })
  resigned_at: Date | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  notes: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
