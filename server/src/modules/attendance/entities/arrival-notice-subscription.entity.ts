import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Check,
} from 'typeorm';
import { School } from '../../schools/entities/school.entity';
import { Student } from '../../students/entities/student.entity';
import { Guardian } from '../../students/entities/guardian.entity';
import { User } from '../../users/entities/user.entity';
import {
  ArrivalNoticeChannel,
  ArrivalNoticeLock,
  ArrivalNoticeMode,
  ArrivalNoticeStatus,
} from '@biddaloy/shared';

/**
 * [84.1.2] One guardian's request to be told when one child is marked in.
 * One row per (tenant, student, guardian).
 *
 * Relations:
 * - @ManyToOne → School (tenant), Student, Guardian: all CASCADE
 * - @ManyToOne → User (set_by, locked_by): SET NULL, nullable
 */
@Entity('arrival_notice_subscriptions')
@Index(
  'UQ_arrival_notice_subscriptions_tenant_student_guardian',
  ['tenant_id', 'student_id', 'guardian_id'],
  { unique: true },
)
@Index('IDX_arrival_notice_subscriptions_tenant_status', ['tenant_id', 'status'])
@Index('IDX_arrival_notice_subscriptions_guardian', ['guardian_id'])
// D35: a lock fixes the row, and only a ONCE row can be spent. `declined_at` marks a staff OFF.
@Check('CHK_arrival_notice_subscriptions_never_off', `"lock" <> 'NEVER' OR "status" = 'OFF'`)
@Check(
  'CHK_arrival_notice_subscriptions_always_active_recurring',
  `"lock" <> 'ALWAYS' OR ("status" = 'ACTIVE' AND "mode" = 'RECURRING' AND "consumed_at" IS NULL)`,
)
@Check('CHK_arrival_notice_subscriptions_consumed_once', `"consumed_at" IS NULL OR "mode" = 'ONCE'`)
@Check('CHK_arrival_notice_subscriptions_declined_off', `"declined_at" IS NULL OR "status" = 'OFF'`)
export class ArrivalNoticeSubscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => Student, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'student_id' })
  student: Student;

  @Column({ type: 'uuid' })
  student_id: string;

  @ManyToOne(() => Guardian, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'guardian_id' })
  guardian: Guardian;

  @Column({ type: 'uuid' })
  guardian_id: string;

  @Column({ type: 'enum', enum: ArrivalNoticeStatus, default: ArrivalNoticeStatus.REQUESTED })
  status: ArrivalNoticeStatus;

  @Column({ type: 'enum', enum: ArrivalNoticeMode, default: ArrivalNoticeMode.RECURRING })
  mode: ArrivalNoticeMode;

  @Column({ type: 'enum', enum: ArrivalNoticeChannel, default: ArrivalNoticeChannel.PUSH })
  channel: ArrivalNoticeChannel;

  @Column({ type: 'enum', enum: ArrivalNoticeLock, default: ArrivalNoticeLock.NONE })
  lock: ArrivalNoticeLock;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'set_by_user_id' })
  set_by: User | null;

  @Column({ type: 'uuid', nullable: true })
  set_by_user_id: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'locked_by_user_id' })
  locked_by: User | null;

  @Column({ type: 'uuid', nullable: true })
  locked_by_user_id: string | null;

  /** When `set_by_user_id` last changed the row (a guardian's own change counts). */
  @Column({ type: 'timestamptz', nullable: true })
  set_at: Date | null;

  /** When `locked_by_user_id` set the current lock; null while the lock is NONE. */
  @Column({ type: 'timestamptz', nullable: true })
  locked_at: Date | null;

  /** Set when a ONCE notice has fired. */
  @Column({ type: 'timestamptz', nullable: true })
  consumed_at: Date | null;

  /** Set when staff turned the row OFF (declined a request or switched it off); null otherwise. */
  @Column({ type: 'timestamptz', nullable: true })
  declined_at: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
