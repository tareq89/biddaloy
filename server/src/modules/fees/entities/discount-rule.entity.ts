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
import { Student } from '../../students/entities/student.entity';
import { School } from '../../schools/entities/school.entity';
import { DiscountKind, FeeType } from '@biddaloy/shared';

/**
 * [16.7.3] A standing discount on one student, applied at fee-generation
 * time by `DiscountRulesService` (implements `fee-generation.service.ts`'s
 * `DiscountResolver`). Money-tier — every write is gated behind
 * `DISCOUNT_RULE_MANAGE` + `@RequireApproval(ApprovalScope.DISCOUNT_RULES_MANAGE)`.
 *
 * `fee_types: NULL` means "applies to every fee type" — never LATE_FEE,
 * which `DiscountRulesService.resolve` special-cases regardless of this
 * column, so a discount never quietly shrinks a late-fee bill.
 */
@Entity('discount_rules')
@Index(['tenant_id'])
@Index(['student_id'])
export class DiscountRule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => School, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  student_id: string;

  @ManyToOne(() => Student, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'student_id' })
  student: Student;

  @Column({ type: 'enum', enum: DiscountKind })
  kind: DiscountKind;

  /** PERCENT: 0-100. FLAT: a taka amount. */
  @Column({ type: 'decimal', precision: 10, scale: 2 })
  value: number;

  /** NULL = applies to every fee type (except LATE_FEE, always excluded). */
  @Column({ type: 'enum', enum: FeeType, array: true, nullable: true })
  fee_types: FeeType[] | null;

  @Column({ type: 'date', nullable: true })
  starts_on: string | null;

  @Column({ type: 'date', nullable: true })
  ends_on: string | null;

  @Column({ type: 'varchar', length: 200 })
  reason: string;

  @Column({ type: 'uuid' })
  created_by_user_id: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;
}
