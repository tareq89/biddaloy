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

  /** Set when a ONCE notice has fired. */
  @Column({ type: 'timestamptz', nullable: true })
  consumed_at: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
