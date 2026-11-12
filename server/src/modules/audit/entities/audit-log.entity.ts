import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { School } from '../../schools/entities/school.entity';
import { AuditAction } from '@biddaloy/shared';
import type { ImpersonationSession } from '../../support-access/entities/impersonation-session.entity';

/**
 * Immutable record of every significant action in the system.
 *
 * Captures who did what, when, and what changed (old vs new values).
 * Used for compliance, debugging, and fee dispute resolution. Records
 * are write-only — never updated or deleted. Covers all CRUD operations,
 * payment receipts, invoice generation, bulk uploads, and reminders.
 *
 * Relations:
 * - @ManyToOne → User (performed_by): the user who performed the action
 *   (null if action was system-triggered or user is deleted)
 * - @ManyToOne → School (tenant): nullable — most actions are tenant-scoped
 *   and get one, but LOGIN/LOGIN_FAILED against an unrecognized identifier
 *   happen before a tenant is ever selected, so there's genuinely nothing to
 *   attribute them to (see migration 1785749259955). onDelete is RESTRICT,
 *   not the CASCADE used on other tenant-scoped tables — a cascaded write
 *   here would hit the write-only trigger and abort, so a tenant with audit
 *   history simply can't be deleted, by design.
 */
// IDX_al_tenant_created is (tenant_id, created_at DESC) in the migration; decorators cannot say DESC.
@Index('IDX_al_tenant_created', ['tenant_id', 'created_at'])
@Entity('audit_logs')
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_al_tenant')
  @ManyToOne(() => School, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School | null;

  @Column({ type: 'uuid', nullable: true })
  tenant_id: string | null;

  @Column({ type: 'enum', enum: AuditAction })
  action: AuditAction;

  @Column({ type: 'varchar', length: 100 })
  entity_type: string;

  @Column({ type: 'uuid', nullable: true })
  entity_id: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'performed_by_user_id' })
  performed_by: User | null;

  @Column({ type: 'uuid', nullable: true })
  performed_by_user_id: string | null;

  @Column({ type: 'jsonb', nullable: true })
  old_values: Record<string, any> | null;

  @Column({ type: 'jsonb', nullable: true })
  new_values: Record<string, any> | null;

  @Column({ type: 'varchar', length: 45, nullable: true })
  ip_address: string | null;

  @Column({ type: 'text', nullable: true })
  user_agent: string | null;

  /** [Epic 99] The platform admin behind this row during a Login as session (stamped by AuditService). */
  @Column({ type: 'uuid', nullable: true })
  impersonated_by_platform_admin_id: string | null;

  /** [Epic 99] The Login as session behind this row. RESTRICT FK in the migration (the write-only trigger blocks SET NULL); no TypeORM relation, so every module that registers AuditLog keeps working. */
  @Index('IDX_al_impersonation_session', { where: '"impersonation_session_id" IS NOT NULL' })
  @Column({ type: 'uuid', nullable: true })
  impersonation_session_id: string | null;

  /** [Epic 99] Transient: set only by AuditService.findAll's join (role only). Not a column, no migration. */
  impersonation_session?: Pick<ImpersonationSession, 'id' | 'role'> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
