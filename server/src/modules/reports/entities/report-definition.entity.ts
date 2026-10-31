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
import type { ReportDefinitionStatus } from '@biddaloy/shared';
import { School } from '../../schools/entities/school.entity';
import { User } from '../../users/entities/user.entity';

/**
 * [8.15.9] A tenant's report: the editable draft lives in the latest
 * `ReportDefinitionVersion` row until published; publishing points
 * `current_version_id` at an immutable version (Epic 8.15 D3). `key` is unique
 * per tenant among live rows (partial unique index in the migration).
 * `system_template_key` marks a clone of a seeded system report (D12).
 */
@Entity('report_definitions')
@Index(['tenant_id'])
@Index('UQ_report_definitions_tenant_key', ['tenant_id', 'key'], {
  unique: true,
  where: '"deleted_at" IS NULL',
})
export class ReportDefinition {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'varchar', length: 80 })
  key: string;

  @Column({ type: 'varchar', length: 160 })
  name_en: string;

  @Column({ type: 'varchar', length: 160 })
  name_bn: string;

  @Column({ type: 'varchar', length: 80, nullable: true })
  folder: string | null;

  @Column({ type: 'varchar', length: 20, default: 'DRAFT' })
  status: ReportDefinitionStatus;

  /** Roles that may run it; empty means every role holding `REPORTS_VIEW`. */
  @Column({ type: 'text', array: true, default: () => "'{}'" })
  visible_roles: string[];

  @Column({ type: 'uuid', nullable: true })
  current_version_id: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  system_template_key: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by' })
  created_by_user: User | null;

  @Column({ type: 'uuid', nullable: true })
  created_by: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'timestamptz' })
  deleted_at: Date | null;
}
