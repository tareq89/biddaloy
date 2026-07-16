import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { AuditAction } from '@beton-boi/shared';

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
 */
@Entity('audit_logs')
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

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

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}