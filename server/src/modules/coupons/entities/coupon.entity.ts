import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Unique,
  Check,
} from 'typeorm';
import { CouponDiscountKind, CouponScope } from '@biddaloy/shared';
import { User } from '../../users/entities/user.entity';

/**
 * A platform discount code (Epic 100). Platform-owned: no tenant RLS, no workbook tab.
 * Money is whole paisa; `uses_count <= max_uses` is a CHECK so a race cannot oversell.
 */
@Entity('coupons')
@Unique('UQ_coupons_code', ['code'])
@Check('CHK_coupons_code_upper', '"code" = upper("code")')
@Check('CHK_coupons_kind', `"discount_kind" IN ('PERCENT','FIXED')`)
@Check(
  'CHK_coupons_value',
  `("discount_kind" = 'PERCENT' AND "percent" IS NOT NULL AND "percent" BETWEEN 1 AND 100 AND "fixed_paisa" IS NULL) OR ("discount_kind" = 'FIXED' AND "fixed_paisa" IS NOT NULL AND "fixed_paisa" >= 1 AND "percent" IS NULL)`,
)
@Check('CHK_coupons_max_months', '"max_months" IS NULL OR "max_months" BETWEEN 1 AND 24')
@Check('CHK_coupons_max_discount', '"max_discount_paisa" IS NULL OR "max_discount_paisa" > 0')
@Check('CHK_coupons_min_order', '"min_order_paisa" IS NULL OR "min_order_paisa" > 0')
@Check('CHK_coupons_scope', `"scope" IN ('ALL','SCHOOLS')`)
@Check('CHK_coupons_max_uses', '"max_uses" IS NULL OR "max_uses" >= 1')
@Check(
  'CHK_coupons_uses_count',
  '"uses_count" >= 0 AND ("max_uses" IS NULL OR "uses_count" <= "max_uses")',
)
@Check('CHK_coupons_per_school_max', '"per_school_max" >= 1')
@Check('CHK_coupons_window', '"ends_at" > "starts_at"')
export class Coupon {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 20 })
  code: string;

  @Column({ type: 'varchar', length: 10 })
  discount_kind: CouponDiscountKind;

  @Column({ type: 'smallint', nullable: true })
  percent: number | null;

  @Column({ type: 'int', nullable: true })
  fixed_paisa: number | null;

  @Column({ type: 'smallint', nullable: true })
  max_months: number | null;

  // bigint comes back from pg as a string.
  @Column({ type: 'bigint', nullable: true })
  max_discount_paisa: string | null;

  @Column({ type: 'bigint', nullable: true })
  min_order_paisa: string | null;

  @Column({ type: 'varchar', length: 10, default: CouponScope.ALL })
  scope: CouponScope;

  @Column({ type: 'int', nullable: true })
  max_uses: number | null;

  @Column({ type: 'int', default: 0 })
  uses_count: number;

  @Column({ type: 'int', default: 1 })
  per_school_max: number;

  @Column({ type: 'timestamptz' })
  starts_at: Date;

  @Column({ type: 'timestamptz' })
  ends_at: Date;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by_user_id', foreignKeyConstraintName: 'FK_coupons_created_by' })
  created_by: User | null;

  @Column({ type: 'uuid', nullable: true })
  created_by_user_id: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
