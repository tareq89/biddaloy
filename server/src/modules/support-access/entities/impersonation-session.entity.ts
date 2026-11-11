import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
  Check,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { School } from '../../schools/entities/school.entity';
import { PlatformAdmin } from '../../platform-identity/entities/platform-admin.entity';

/**
 * [Epic 99] One Login as request/session by a platform admin (see migration 1792100000000).
 * Platform data: not tenant-filtered, never in the school workbook or demo seed.
 */
@Entity('impersonation_sessions')
@Index('IDX_impersonation_sessions_admin_status', ['platform_admin_id', 'status'])
@Index('IDX_impersonation_sessions_tenant_created', ['tenant_id', 'created_at'])
@Index('IDX_impersonation_sessions_status_expires', ['status', 'expires_at'])
@Check(
  'CHK_impersonation_sessions_status',
  `"status" IN ('REQUESTED', 'APPROVED', 'ACTIVE', 'ENDED', 'EXPIRED', 'DENIED')`,
)
@Check('CHK_impersonation_sessions_entry_kind', `"entry_kind" IN ('NORMAL', 'EMERGENCY')`)
@Check('CHK_impersonation_sessions_reason', `char_length(btrim("reason")) > 0`)
export class ImpersonationSession {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_impersonation_sessions' })
  id: string;

  @Column({ type: 'uuid' })
  platform_admin_id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'uuid' })
  target_user_id: string;

  @Column({ type: 'varchar', length: 20 })
  role: string;

  /** REQUESTED | APPROVED | ACTIVE | ENDED | EXPIRED | DENIED (CHECK in the DB). */
  @Column({ type: 'varchar', length: 12 })
  status: string;

  /** NORMAL | EMERGENCY (CHECK in the DB). */
  @Column({ type: 'varchar', length: 10 })
  entry_kind: string;

  @Column({ type: 'boolean', default: true })
  view_only: boolean;

  /** Emergency sessions start read-only (D22). */
  @Column({ type: 'boolean', default: false })
  write_locked: boolean;

  /** The owner asked for write access (D45). */
  @Column({ type: 'timestamptz', nullable: true })
  write_requested_at: Date | null;

  @Column({ type: 'text' })
  reason: string;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  requested_at: Date;

  @Column({ type: 'uuid', nullable: true })
  decided_by: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  decided_at: Date | null;

  /** The 24 h ticket of an approved `ask` (D21). */
  @Column({ type: 'timestamptz', nullable: true })
  ticket_expires_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  started_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  expires_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  ended_at: Date | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  ended_by: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @ManyToOne(() => PlatformAdmin, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'platform_admin_id',
    foreignKeyConstraintName: 'FK_impersonation_sessions_platform_admin_id',
  })
  platform_admin: PlatformAdmin;

  @ManyToOne(() => School, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'tenant_id',
    foreignKeyConstraintName: 'FK_impersonation_sessions_tenant_id',
  })
  tenant: School;

  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'target_user_id',
    foreignKeyConstraintName: 'FK_impersonation_sessions_target_user_id',
  })
  target_user: User;

  @ManyToOne(() => User, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'decided_by',
    foreignKeyConstraintName: 'FK_impersonation_sessions_decided_by',
  })
  decided_by_user: User | null;
}
