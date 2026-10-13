import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Check,
} from 'typeorm';

/**
 * [75.34] Platform-only incident state (a Redis outage). No tenant, no soft delete.
 * "One open row per kind" is a partial unique index (see the migration
 * `1791805000600-PlatformAlerts.ts`), declared here too so the schema-drift check stays clean.
 */
@Entity('platform_alerts')
@Index('UQ_platform_alerts_open_kind', ['kind'], { unique: true, where: '"cleared_at" IS NULL' })
@Check('CHK_platform_alerts_kind', `"kind" IN ('REDIS_DOWN')`)
export class PlatformAlert {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 32 })
  kind: 'REDIS_DOWN';

  @Column({ type: 'timestamptz', default: () => 'now()' })
  opened_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  cleared_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  last_sms_at: Date | null;

  @Column({ type: 'int', default: 0 })
  sms_count: number;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
