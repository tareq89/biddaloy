import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
  Check,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { School } from '../../schools/entities/school.entity';

/**
 * Defines the school calendar period (e.g., "2026-2027").
 *
 * All fee structures, class enrollments, and fee generations are scoped
 * to an academic year. Only one year can be marked is_current at a time
 * per tenant (enforced by a partial unique index).
 *
 * Relations:
 * - @ManyToOne → School: the tenant this academic year belongs to
 * - Referenced-by → Class: classes belong to an academic year
 * - Referenced-by → FeeStructure: fees are set per academic year
 * - Referenced-by → StudentFee: generated fees are tied to a year
 */
@Entity('academic_years')
@Check('CHK_academic_years_closed_not_current', '"closed_at" IS NULL OR "is_current" = false')
@Index('IDX_academic_years_tenant_closed', ['tenant_id', 'closed_at'], {
  where: '"closed_at" IS NOT NULL',
})
// The migrated DB index is lower(name) (1791900000400-CaseInsensitiveAcademicNames); this decorator is only the
// exact-case shadow for synchronize-built test schemas.
@Index(['name', 'tenant_id'], { unique: true, where: '"deleted_at" IS NULL' })
@Index(['is_current', 'tenant_id'], {
  unique: true,
  where: '"is_current" = true AND "deleted_at" IS NULL',
})
export class AcademicYear {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 50 })
  name: string;

  @Column({ type: 'date' })
  start_date: Date;

  @Column({ type: 'date' })
  end_date: Date;

  @Column({ type: 'boolean', default: false })
  is_current: boolean;

  /**
   * closed = read-only for every row with this academic_year_id (D4); enforced by
   * `assertYearOpen` (#3511). DB CHECK CHK_academic_years_closed_not_current: a closed year is
   * never current (D21).
   */
  @Column({ type: 'timestamptz', nullable: true })
  closed_at: Date | null;

  /**
   * Who closed the year. A plain uuid on purpose, not a relation to User: a relation makes every
   * spec that lists entities by hand also list User and its whole chain (UserTenant, ...).
   */
  @Column({ type: 'uuid', nullable: true })
  closed_by_user_id: string | null;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;
}
