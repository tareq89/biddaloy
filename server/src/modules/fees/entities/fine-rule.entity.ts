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
import { FeeStructure } from './fee-structure.entity';
import { Class } from '../../academics/entities/class.entity';
import { FineTrigger } from '@biddaloy/shared';

/**
 * [38.1.2] A school's standing fine policy for one `FineTrigger` — "absent
 * more than N periods in a month costs ৳20 per period after that, capped at
 * ৳200" — evaluated by the (later-wave) fines engine (D6) and turned into
 * FINE bills through `FeeGenerationService.generate()` (D2).
 *
 * `class_id: null` means a school-default rule (D22: unique per
 * tenant/year/trigger/class with `NULLS NOT DISTINCT`, so only one
 * school-default and one per-class rule can be active per trigger at once).
 */
@Entity('fine_rules')
@Index('IDX_fine_rules_tenant_year', ['tenant_id', 'academic_year_id'])
export class FineRule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => School, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  academic_year_id: string;

  @ManyToOne(() => AcademicYear)
  @JoinColumn({ name: 'academic_year_id' })
  academic_year: AcademicYear;

  @Column({ type: 'enum', enum: FineTrigger })
  trigger: FineTrigger;

  @Column({ type: 'uuid' })
  fee_structure_id: string;

  @ManyToOne(() => FeeStructure)
  @JoinColumn({ name: 'fee_structure_id' })
  fee_structure: FeeStructure;

  /** null = a school-wide default rule for this trigger. */
  @Column({ type: 'uuid', nullable: true })
  class_id: string | null;

  @ManyToOne(() => Class, { nullable: true })
  @JoinColumn({ name: 'class_id' })
  class: Class | null;

  /** How many occurrences of the trigger in a period are free before fining. */
  @Column({ type: 'int', default: 0 })
  free_per_period: number;

  /** Max total fine amount per period; null = no cap. */
  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  cap_per_period: number | null;

  /**
   * Trigger-specific tuning, e.g. `{ min_minutes_late: 10 }` for
   * ATTENDANCE_LATE. Typed as a primitive-valued record rather than
   * `Record<string, unknown>` — TypeORM's `DeepPartial` recursion chokes on
   * an `unknown`-valued index signature once this entity is a relation on
   * another one (surfaced in `checkout.service.integration.spec.ts`'s
   * `studentFeeRepo.save()` calls, via `StudentFee.fine_rule`).
   */
  @Column({ type: 'jsonb', default: {} })
  conditions: Record<string, string | number | boolean | null>;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @Column({ type: 'uuid', nullable: true })
  created_by_user_id: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;
}
