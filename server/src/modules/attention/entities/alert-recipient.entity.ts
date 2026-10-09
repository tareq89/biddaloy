import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { AlertRecipientState, UserRole } from '@biddaloy/shared';
import { School } from '../../schools/entities/school.entity';
import { Alert } from './alert.entity';

/**
 * [67.1.02] Per-user delivery/read state of an {@link Alert}.
 *
 * Relations: tenant (School), alert (cascade). `student_id` is context only
 * (no FK, derived data). The DB also enforces a composite (tenant_id, alert_id)
 * FK so a recipient can't point at another tenant's alert. No soft delete:
 * derived data, lifecycle is `state` + the 12-month prune (D31). Indexes and
 * the NULLS NOT DISTINCT unique live only in the migration.
 */
@Entity('alert_recipients')
export class AlertRecipient {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  alert_id: string;

  @ManyToOne(() => Alert, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'alert_id' })
  alert: Alert;

  @Column({ type: 'uuid' })
  user_id: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  role: UserRole | null;

  @Column({ type: 'uuid', nullable: true })
  student_id: string | null;

  @Column({ type: 'varchar', length: 10, default: AlertRecipientState.OPEN })
  state: AlertRecipientState;

  @Column({ type: 'timestamptz', nullable: true })
  seen_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  hidden_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  snoozed_until: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  pushed_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  sms_sent_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  resolved_at: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
