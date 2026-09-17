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
import { ApiProperty } from '@nestjs/swagger';
import { School } from '../../schools/entities/school.entity';
import { AcademicYear } from '../../academics/entities/academic-year.entity';
import { User } from '../../users/entities/user.entity';
import { PeriodType } from '@biddaloy/shared';

/** Who a schedule bills: an optional class/section label plus enrollment
 * status. `class_id`/`section_id` unset means "every class". */
export class RecurringScheduleAudience {
  @ApiProperty({ required: false })
  class_id?: string;

  @ApiProperty({ required: false })
  section_id?: string;

  @ApiProperty()
  enrollment_status: 'ACTIVE';
}

/** A monthly rule fires on `day_of_month` (1..28, or `'LAST'` for the
 * month's final day — Feb-safe without per-month special-casing at the
 * call site). A weekly rule fires on each listed ISO weekday
 * (1=Monday..7=Sunday). `recurrence.util.ts` is the only place that reads
 * these shapes. */
export type RecurringScheduleRule =
  { kind: 'MONTHLY'; day_of_month: number | 'LAST' } | { kind: 'WEEKLY'; weekdays: number[] };

/**
 * [16.7.1] A saved "generate these fees automatically" definition — the
 * schedule itself. Actually generating fees on the due date is 16.7.2's
 * scheduler job; this entity and its service only store the definition,
 * resolve who it currently targets, and let staff manage exclusions.
 *
 * Relations:
 * - @ManyToOne → School (tenant)
 * - @ManyToOne → AcademicYear: the year the schedule runs within;
 *   `ends_on` may not exceed `academic_year.end_date` (epic #637 D4)
 * - @ManyToOne → User (created_by): who created the schedule
 * - Referenced-by → RecurringScheduleStructure: which fee structures it bills
 * - Referenced-by → RecurringScheduleExclusion: students carved out of `audience`
 * - Referenced-by → FeeGeneration (`recurring_schedule_id`): batches this
 *   schedule produced (written by 16.7.2, not this ticket)
 */
@Entity('recurring_schedules')
@Index(['tenant_id'])
@Index(['tenant_id', 'academic_year_id'])
export class RecurringSchedule {
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

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @ApiProperty({ type: () => RecurringScheduleAudience })
  @Column({ type: 'jsonb' })
  audience: RecurringScheduleAudience;

  @ApiProperty()
  @Column({ type: 'jsonb' })
  rule: RecurringScheduleRule;

  @Column({ type: 'enum', enum: PeriodType })
  period_type: PeriodType;

  @Column({ type: 'int', default: 9 })
  due_days_after_period_start: number;

  @Column({ type: 'date' })
  starts_on: string;

  @Column({ type: 'date' })
  ends_on: string;

  @Column({ type: 'boolean', default: true })
  notify_families: boolean;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  /** Set by 16.7.2's scheduler after it fires for a period; this ticket
   * never writes it. */
  @Column({ type: 'date', nullable: true })
  last_run_period: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'created_by_user_id' })
  created_by: User | null;

  @Column({ type: 'uuid', nullable: true })
  created_by_user_id: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;
}
