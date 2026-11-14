import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index, Check } from 'typeorm';

/** Fixed id of the default 'Standard' plan (D42): school creation needs no code change. */
export const DEFAULT_PLAN_ID = '00000000-0000-4000-8000-000000000001';

/**
 * A price per seat per month (Epic 100). Platform-owned: no tenant RLS, no workbook tab.
 * `unit_price_paisa` is whole paisa (Rule 26). The unique `lower(name)` index is
 * migration-only (`PlansCouponsRefunds1792200000000`); `module.helper.ts` re-creates it
 * for synchronize-built schemas.
 */
@Entity('plans')
@Check('CHK_plans_unit_price', '"unit_price_paisa" BETWEEN 1 AND 100000000')
@Check('CHK_plans_default_active', 'NOT "is_default" OR "active"')
export class Plan {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 60 })
  name: string;

  @Column({ type: 'int' })
  unit_price_paisa: number;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @Index('UQ_plans_one_default', { unique: true, where: '"is_default"' })
  @Column({ type: 'boolean', default: false })
  is_default: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
