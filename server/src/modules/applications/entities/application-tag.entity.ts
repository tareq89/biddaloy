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
import { APPLICATION_TAG_ROLES } from '@biddaloy/shared';
import { School } from '../../schools/entities/school.entity';
import { User } from '../../users/entities/user.entity';
import { Application } from './application.entity';

/**
 * [52.1.2] A tagged person (`user_id`) or role (`role`) on an application
 * (D12, D14): can view and comment, never decide. Exactly one of the two is set.
 * A role must be one of `APPLICATION_TAG_ROLES` (tenant staff, D50).
 */
@Entity('application_tags')
@Index('IDX_application_tags_tenant_application', ['tenant_id', 'application_id'])
@Index('UQ_application_tags_user', ['application_id', 'user_id'], {
  unique: true,
  where: '"user_id" IS NOT NULL',
})
@Index('UQ_application_tags_role', ['application_id', 'role'], {
  unique: true,
  where: '"role" IS NOT NULL',
})
@Index('IDX_application_tags_tenant_user', ['tenant_id', 'user_id'], {
  where: '"user_id" IS NOT NULL',
})
@Index('IDX_application_tags_tenant_role', ['tenant_id', 'role'], { where: '"role" IS NOT NULL' })
@Check('CHK_application_tags_user_xor_role', `num_nonnulls("user_id", "role") = 1`)
@Check(
  'CHK_application_tags_role',
  `"role" IN (${APPLICATION_TAG_ROLES.map((role) => `'${role}'`).join(', ')})`,
)
export class ApplicationTag {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => Application, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'application_id' })
  application: Application;

  @Column({ type: 'uuid' })
  application_id: string;

  @ManyToOne(() => User, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User | null;

  @Column({ type: 'uuid', nullable: true })
  user_id: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  role: string | null;

  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'created_by_user_id' })
  created_by: User;

  @Column({ type: 'uuid' })
  created_by_user_id: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
