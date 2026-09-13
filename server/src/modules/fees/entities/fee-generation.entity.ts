import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { School } from '../../schools/entities/school.entity';
import { AcademicYear } from '../../academics/entities/academic-year.entity';
import { User } from '../../users/entities/user.entity';
import { PeriodType, FeeGenerationSource, DuplicateStrategy } from '@biddaloy/shared';

/** One `structures[]` entry snapshotted at generation time — the fee
 * catalog can change later, but a past batch's own log stays accurate to
 * what it actually charged. */
export class FeeGenerationStructureSnapshot {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  fee_type: string;

  @ApiProperty()
  amount: number;
}

/**
 * One row per Generate press or schedule run (16.1.4) — the audit trail
 * behind the fee-generation log page. `FeeGenerationsService.create` is the
 * single write API (used by the manual-generate flow in 16.3.1 and the
 * scheduler in 16.7.2); everything else in this module only reads it.
 *
 * Relations:
 * - @ManyToOne → School (tenant): the tenant this batch belongs to
 * - @ManyToOne → AcademicYear: the academic year the batch generated for
 * - @ManyToOne → User (generated_by, approved_by): who ran/approved it
 * - Referenced-by → StudentFee (`fee_generation_id`, added by this
 *   ticket's migration, `ON DELETE SET NULL`): the bills this batch created
 */
@Entity('fee_generations')
@Index(['tenant_id'])
@Index(['tenant_id', 'created_at'])
export class FeeGeneration {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => AcademicYear, { nullable: false })
  @JoinColumn({ name: 'academic_year_id' })
  academic_year: AcademicYear;

  @Column({ type: 'uuid' })
  academic_year_id: string;

  @Column({ type: 'date' })
  period_start: Date;

  @Column({ type: 'enum', enum: PeriodType })
  period_type: PeriodType;

  @Column({ type: 'date' })
  due_date: Date;

  @Column({ type: 'enum', enum: FeeGenerationSource })
  source: FeeGenerationSource;

  /** FK added by 16.7.1's recurring-schedule migration. Left as a plain
   * nullable uuid column (no relation) here since that entity doesn't
   * exist yet in this ticket's scope. */
  @Column({ type: 'uuid', nullable: true })
  recurring_schedule_id: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'generated_by_user_id' })
  generated_by: User | null;

  @Column({ type: 'uuid', nullable: true })
  generated_by_user_id: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'approved_by_user_id' })
  approved_by: User | null;

  @Column({ type: 'uuid', nullable: true })
  approved_by_user_id: string | null;

  @Column({ type: 'enum', enum: DuplicateStrategy })
  duplicate_strategy: DuplicateStrategy;

  @Column({ type: 'boolean', default: false })
  notify_families: boolean;

  @ApiProperty({ type: () => [FeeGenerationStructureSnapshot] })
  @Column({ type: 'jsonb' })
  structures: FeeGenerationStructureSnapshot[];

  @Column({ type: 'int' })
  student_count: number;

  @Column({ type: 'int' })
  generated_count: number;

  @Column({ type: 'int' })
  skipped_count: number;

  @Column({ type: 'int' })
  removed_count: number;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;
}
