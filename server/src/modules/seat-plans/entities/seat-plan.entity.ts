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
import { SeatPlanStatus, SeatOrderMode } from '@biddaloy/shared';
import { School } from '../../schools/entities/school.entity';

/**
 * [25.1.1] A seat plan — a named grouping of one or more exam schedules
 * (subject sittings) whose students get seat allocations generated
 * together. DRAFT can still be edited; PUBLISHED locks its schedules (D6,
 * enforced in the service layer, #25.4) and its allocations become visible
 * to invigilators.
 *
 * Relations:
 * - @ManyToOne → School: tenant this plan belongs to
 * - Referenced-by → SeatPlanSchedule: the exam schedules this plan covers
 * - Referenced-by → SeatAllocation: the generated seat assignments
 */
@Entity('seat_plans')
@Index(['tenant_id'])
export class SeatPlan {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({
    type: 'enum',
    enum: SeatPlanStatus,
    default: SeatPlanStatus.DRAFT,
  })
  status: SeatPlanStatus;

  @Column({
    type: 'enum',
    enum: SeatOrderMode,
  })
  seat_order_mode: SeatOrderMode;

  @Column({ type: 'timestamptz', nullable: true })
  published_at: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;
}
