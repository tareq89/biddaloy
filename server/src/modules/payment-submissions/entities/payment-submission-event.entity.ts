import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { PaymentSubmissionStatus } from '@biddaloy/shared';
import { School } from '../../schools/entities/school.entity';
import { User } from '../../users/entities/user.entity';
import { PaymentSubmission } from './payment-submission.entity';

/**
 * [3.x] Append-only status history (D9). No `updated_at`; use the repository's `insert` only,
 * never `save`/`update`/`delete`. `from_status` is null on the first row.
 */
@Entity('payment_submission_events')
@Index(['tenant_id'])
@Index(['submission_id'])
export class PaymentSubmissionEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => PaymentSubmission, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'submission_id' })
  submission: PaymentSubmission;

  @Column({ type: 'uuid' })
  submission_id: string;

  @Column({ type: 'enum', enum: PaymentSubmissionStatus, nullable: true })
  from_status: PaymentSubmissionStatus | null;

  @Column({ type: 'enum', enum: PaymentSubmissionStatus })
  to_status: PaymentSubmissionStatus;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'actor_user_id' })
  actor: User | null;

  @Column({ type: 'uuid', nullable: true })
  actor_user_id: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  reason_code: string | null;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
