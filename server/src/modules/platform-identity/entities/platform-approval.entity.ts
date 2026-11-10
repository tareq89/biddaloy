import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Check,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

/** [Epic 98] A two-owner approval request. Status is varchar + CHECK, typed in TS. */
@Entity('platform_approvals')
@Index('IDX_platform_approvals_status_expires', ['status', 'expires_at'])
@Check(
  'CHK_platform_approvals_status',
  `"status" IN ('PENDING', 'GRANTED', 'DENIED', 'USED', 'EXPIRED')`,
)
export class PlatformApproval {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_platform_approvals' })
  id: string;

  @Column({ type: 'varchar', length: 60 })
  scope: string;

  @Column({ type: 'varchar', length: 64 })
  payload_hash: string;

  @Column({ type: 'jsonb' })
  summary: Record<string, unknown>;

  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'requested_by',
    foreignKeyConstraintName: 'FK_platform_approvals_requested_by',
  })
  requested_by_user: User;

  @Column({ type: 'uuid' })
  requested_by: string;

  @Column({ type: 'varchar', length: 12, default: 'PENDING' })
  status: 'PENDING' | 'GRANTED' | 'DENIED' | 'USED' | 'EXPIRED';

  @ManyToOne(() => User, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'decided_by', foreignKeyConstraintName: 'FK_platform_approvals_decided_by' })
  decided_by_user: User | null;

  @Column({ type: 'uuid', nullable: true })
  decided_by: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  decided_at: Date | null;

  @Column({ type: 'timestamptz' })
  expires_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  used_at: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
