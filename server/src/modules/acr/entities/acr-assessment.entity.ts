import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Unique,
} from 'typeorm';
import { School } from '../../schools/entities/school.entity';

export type AcrAssessmentStatus = 'INCOMPLETE' | 'COMPLETED';

/**
 * [28.1.2] A staff member's ACR for one academic year. Privacy-sensitive:
 * every read must be tenant-scoped.
 */
@Entity('acr_assessments')
@Unique('UQ_acr_assessments_tenant_user_year', ['tenant_id', 'user_id', 'academic_year_id'])
export class AcrAssessment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  user_id: string;

  @Column({ type: 'uuid' })
  academic_year_id: string;

  @Column({ type: 'uuid' })
  form_version_id: string;

  @Column({ type: 'varchar', length: 20, default: 'INCOMPLETE' })
  status: AcrAssessmentStatus;

  @Column({ type: 'integer', nullable: true })
  total: number | null;

  @Column({ type: 'uuid' })
  assessed_by: string;

  @Column({ type: 'jsonb', nullable: true })
  step1_data: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  step3_data: Record<string, unknown> | null;

  @Column({ type: 'timestamptz', nullable: true })
  completed_at: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
