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
import { StaffProfile } from '../../staff-profiles/entities/staff-profile.entity';
import { User } from '../../users/entities/user.entity';
import { LeaveType, LeaveStatus } from '@biddaloy/shared';

/**
 * [36.3] One staff member's leave request/decision. Balance is never
 * stored here — `LeaveService.getBalance` sums `APPROVED` rows for the
 * current calendar year live (D12). Matches migration
 * `StaffAttendanceLeave1789800014000` exactly.
 */
@Entity('leave_records')
@Index(['staff_profile_id'])
export class LeaveRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => StaffProfile, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'staff_profile_id' })
  staff_profile: StaffProfile;

  @Column({ type: 'uuid' })
  staff_profile_id: string;

  @Column({ type: 'enum', enum: LeaveType })
  leave_type: LeaveType;

  @Column({ type: 'date' })
  start_date: string;

  @Column({ type: 'date' })
  end_date: string;

  @Column({ type: 'int' })
  days: number;

  @Column({ type: 'enum', enum: LeaveStatus, default: LeaveStatus.PENDING })
  status: LeaveStatus;

  @Column({ type: 'varchar', length: 255, nullable: true })
  reason: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'approved_by' })
  approver: User | null;

  @Column({ type: 'uuid', nullable: true })
  approved_by: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  decided_at: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
