import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { School } from '../../schools/entities/school.entity';
import { ReminderBatchStatus } from '@beton-boi/shared';

/**
 * Tracks a bulk reminder campaign sent to multiple students' guardians.
 *
 * When a user sends reminders to all flagged students (e.g., "fee overdue"),
 * a ReminderBatch is created to track the campaign's progress, success
 * rate, and the filters used to select recipients. Each individual message
 * is recorded in CommunicationLog.
 *
 * Relations:
 * - @ManyToOne → School: the tenant this batch belongs to. Stored directly
 *   rather than derived through initiated_by, so a batch can never be read
 *   by a tenant the initiating user also happens to be a member of.
 * - @ManyToOne → User (initiated_by): the staff member who triggered the batch
 * - Referenced-by → CommunicationLog: individual messages from this batch
 */
@Entity('reminder_batches')
@Index(['tenant_id'])
export class ReminderBatch {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'varchar', length: 200 })
  batch_name: string;

  @Column({ type: 'enum', enum: ReminderBatchStatus, default: ReminderBatchStatus.PROCESSING })
  status: ReminderBatchStatus;

  @Column({ type: 'int' })
  total_recipients: number;

  @Column({ type: 'int', default: 0 })
  successful_count: number;

  @Column({ type: 'int', default: 0 })
  failed_count: number;

  @Column({ type: 'text', nullable: true })
  message_template: string | null;

  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({ name: 'initiated_by_user_id' })
  initiated_by: User;

  @Column({ type: 'uuid' })
  initiated_by_user_id: string;

  @Column({ type: 'jsonb', nullable: true })
  filters_applied: Record<string, any> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
