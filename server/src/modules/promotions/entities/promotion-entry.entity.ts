import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Check,
} from 'typeorm';
import { PromotionOutcome } from '@biddaloy/shared';
import { School } from '../../schools/entities/school.entity';
import { PromotionRun } from './promotion-run.entity';

/**
 * [788] One student's decision within a `PromotionRun`: their merit stats,
 * the algorithm's `suggested_outcome`, and the possibly-overridden
 * `final_outcome` actually applied on commit (D6/D11).
 *
 * `is_override = true` requires a non-blank `override_note` — enforced by
 * the DB CHECK constraint below (D6/D11 invariant at the DB level, not
 * just app-layer validation).
 *
 * No `deleted_at` — entries are hard-deleted via `run_id` CASCADE when
 * their (hard-deleted) `PromotionRun` is discarded (D24).
 *
 * `target_enrollment_id` is set on commit, once placement has actually
 * created the student's next-year enrollment.
 *
 * Relations:
 * - @ManyToOne → School: tenant this entry belongs to
 * - @ManyToOne → PromotionRun: the run this entry is part of
 */
@Entity('promotion_entries')
@Index(['run_id', 'student_id'], { unique: true })
@Index(['tenant_id'])
@Index(['tenant_id', 'student_id'], { where: '"is_override" = true' })
@Check(
  'CHK_promotion_entries_override_note',
  `(NOT "is_override" OR ("override_note" IS NOT NULL AND length(btrim("override_note", E' \\t\\r\\n')) > 0))`,
)
export class PromotionEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => PromotionRun, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'run_id' })
  run: PromotionRun;

  @Column({ type: 'uuid' })
  run_id: string;

  @Column({ type: 'uuid' })
  student_id: string;

  @Column({ type: 'uuid' })
  source_enrollment_id: string;

  @Column({ type: 'uuid', nullable: true })
  source_section_id: string | null;

  @Column({ type: 'int', nullable: true })
  merit_rank: number | null;

  @Column({ type: 'numeric', precision: 4, scale: 2, nullable: true })
  mean_gpa: string | null;

  @Column({ type: 'numeric', precision: 10, scale: 2, nullable: true })
  total_marks_sum: string | null;

  @Column({ type: 'boolean' })
  passed_all: boolean;

  @Column({ type: 'varchar', length: 20 })
  suggested_outcome: PromotionOutcome;

  @Column({ type: 'varchar', length: 20 })
  final_outcome: PromotionOutcome;

  @Column({ type: 'boolean', default: false })
  is_override: boolean;

  /** Required (non-blank) when `is_override` is true — DB check constraint. */
  @Column({ type: 'text', nullable: true })
  override_note: string | null;

  @Column({ type: 'uuid', nullable: true })
  overridden_by_user_id: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  group_name: string | null;

  @Column({ type: 'uuid', nullable: true })
  target_class_id: string | null;

  @Column({ type: 'uuid', nullable: true })
  target_section_id: string | null;

  @Column({ type: 'int', nullable: true })
  new_roll_number: number | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  placement_error: string | null;

  /** Set on commit, once placement has created the next-year enrollment. */
  @Column({ type: 'uuid', nullable: true })
  target_enrollment_id: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
