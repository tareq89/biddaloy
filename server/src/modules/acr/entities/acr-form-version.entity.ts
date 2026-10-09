import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Unique,
} from 'typeorm';
import { School } from '../../schools/entities/school.entity';

/**
 * [28.1.2] One published version of the ACR form. Criteria hang off a version
 * so old assessments keep the form they were scored against.
 *
 * Other FKs (created_by → users) are enforced in the migration; only the
 * tenant relation is mapped here.
 */
@Entity('acr_form_versions')
@Unique('UQ_acr_form_versions_tenant_version', ['tenant_id', 'version'])
export class AcrFormVersion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'integer' })
  version: number;

  @Column({ type: 'uuid' })
  created_by: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
