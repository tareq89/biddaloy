import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { RecurringSchedule } from './recurring-schedule.entity';
import { FeeStructure } from './fee-structure.entity';

/**
 * [16.7.1] Which `FeeStructure`s one `RecurringSchedule` bills each time it
 * fires — a plain join row, no extra columns. `clone()` matches these across
 * academic years by the target year's `(name, fee_type)` pair (the ticket's
 * clone rule), since a `FeeStructure` row itself is year-scoped and never
 * shared across years.
 */
@Entity('recurring_schedule_structures')
@Index(['schedule_id', 'fee_structure_id'], { unique: true })
export class RecurringScheduleStructure {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => RecurringSchedule, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'schedule_id' })
  schedule: RecurringSchedule;

  @Column({ type: 'uuid' })
  schedule_id: string;

  @ManyToOne(() => FeeStructure, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'fee_structure_id' })
  fee_structure: FeeStructure;

  @Column({ type: 'uuid' })
  fee_structure_id: string;
}
