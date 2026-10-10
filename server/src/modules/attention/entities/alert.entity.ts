import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { AlertCategory, AlertSeverity, AlertSource, AlertStatus } from '@biddaloy/shared';
import { School } from '../../schools/entities/school.entity';

/**
 * [67.1.02] One raised attention alert (rule-driven or manual).
 *
 * Relations: tenant (School). Recipients live in `alert_recipients`; there is
 * deliberately no `@OneToMany` here (TypeORM partial-collection save trap).
 * No soft delete: derived data, lifecycle is `status` + the 12-month prune (D31).
 * Indexes/uniques (partial active-dedupe etc.) live only in the migration
 * `1791600000000-AttentionAlerts.ts`; `@Index` can't express them.
 */
@Entity('alerts')
export class Alert {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'varchar', length: 64 })
  rule_key: string;

  @Column({ type: 'varchar', length: 10 })
  source: AlertSource;

  @Column({ type: 'varchar', length: 10 })
  severity: AlertSeverity;

  @Column({ type: 'varchar', length: 20 })
  category: AlertCategory;

  @Column({ type: 'varchar', length: 10, default: AlertStatus.ACTIVE })
  status: AlertStatus;

  @Column({ type: 'varchar', length: 200 })
  dedupe_key: string;

  @Column({ type: 'varchar', length: 32, nullable: true })
  subject_type: string | null;

  @Column({ type: 'uuid', nullable: true })
  subject_id: string | null;

  @Column({ type: 'jsonb', default: () => `'{}'` })
  params: Record<string, string | number>;

  @Column({ type: 'varchar', length: 500, nullable: true })
  action_url: string | null;

  @Column({ type: 'smallint', default: 0 })
  escalation_level: number;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  raised_at: Date;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  last_evaluated_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  resolved_at: Date | null;

  @Column({ type: 'uuid', nullable: true })
  resolved_by_user_id: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  expires_at: Date | null;

  @Column({ type: 'uuid', nullable: true })
  created_by_user_id: string | null;

  @Column({ type: 'varchar', length: 140, nullable: true })
  manual_title: string | null;

  @Column({ type: 'text', nullable: true })
  manual_body: string | null;

  @Column({ type: 'jsonb', nullable: true })
  manual_audience: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
