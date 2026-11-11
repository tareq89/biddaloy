import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { School } from '../../schools/entities/school.entity';

/** [Epic 99] A platform admin's private note on a school. Platform data, not school data. */
@Entity('platform_school_notes')
@Index('IDX_platform_school_notes_tenant_created', ['tenant_id', 'created_at'])
export class PlatformSchoolNote {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_platform_school_notes' })
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'uuid' })
  author_id: string;

  @Column({ type: 'varchar', length: 2000 })
  body: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @ManyToOne(() => School, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'tenant_id', foreignKeyConstraintName: 'FK_platform_school_notes_tenant_id' })
  tenant: School;

  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'author_id', foreignKeyConstraintName: 'FK_platform_school_notes_author_id' })
  author: User;
}
