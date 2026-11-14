import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { School } from '../../schools/entities/school.entity';
import { AdmissionStage } from './admission-stage.entity';
import { AdmissionApplicant } from './admission-applicant.entity';

/**
 * [Epic 71 D1] One applicant's outcome at one stage.
 *
 * Relations:
 * - @ManyToOne → School: tenant
 * - @ManyToOne → AdmissionStage / AdmissionApplicant
 */
@Entity('admission_stage_results')
@Index('UQ_admission_stage_results_applicant', ['tenant_id', 'stage_id', 'applicant_id'], {
  unique: true,
  where: '"deleted_at" IS NULL',
})
export class AdmissionStageResult {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => AdmissionStage, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'stage_id' })
  stage: AdmissionStage;

  @Column({ type: 'uuid' })
  stage_id: string;

  @ManyToOne(() => AdmissionApplicant, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'applicant_id' })
  applicant: AdmissionApplicant;

  @Column({ type: 'uuid' })
  applicant_id: string;

  /** Score; the service checks bounds. */
  @Column({ type: 'numeric', precision: 8, scale: 2, nullable: true })
  score: string | null;

  @Column({ type: 'boolean', nullable: true })
  passed: boolean | null;

  @Column({ type: 'text', nullable: true })
  remarks: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;
}
