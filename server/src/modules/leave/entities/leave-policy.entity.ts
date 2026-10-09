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
import { LeaveType } from '@biddaloy/shared';

/**
 * [36.3] A tenant's annual quota for one `LeaveType`. Seeded with D9
 * defaults per tenant by migration `StaffAttendanceLeave1789800014000`;
 * this entity must match that schema exactly.
 */
@Entity('leave_policies')
@Index(['tenant_id', 'leave_type'], { unique: true })
export class LeavePolicy {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'enum', enum: LeaveType })
  leave_type: LeaveType;

  @Column({ type: 'int' })
  annual_quota_days: number;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
