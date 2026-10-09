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
import { User } from '../../users/entities/user.entity';

/**
 * A family member row for one staff member (23.3). Joined by
 * `(staff_user_id, tenant_id)` — no FK to `StaffHrRecord` (same reasoning as
 * D1 for the core record: this can exist independent of it).
 */
@Entity('staff_family_members')
@Index(['tenant_id'])
@Index(['staff_user_id'])
export class StaffFamilyMember {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'staff_user_id' })
  staff_user: User;

  @Column({ type: 'uuid' })
  staff_user_id: string;

  @Column({ type: 'varchar', length: 100 })
  relation: string;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  occupation: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  contact: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
