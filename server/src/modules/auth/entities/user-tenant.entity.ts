import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Unique,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { School } from '../../schools/entities/school.entity';
import { UserRole } from '@beton-boi/shared';

/**
 * Junction table linking a User to a School (tenant) with a specific role.
 *
 * A user can have multiple memberships — e.g., Teacher in School A and
 * Guardian in School B. The unique constraint on (user_id, tenant_id, role)
 * prevents duplicate role assignments within the same school.
 *
 * Relations:
 * - @ManyToOne → User: the user account
 * - @ManyToOne → School: the tenant/school
 */
@Entity('user_tenants')
@Unique(['user_id', 'tenant_id', 'role'])
@Index(['user_id'])
@Index(['tenant_id'])
export class UserTenant {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'uuid' })
  user_id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'enum', enum: UserRole })
  role: UserRole;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}