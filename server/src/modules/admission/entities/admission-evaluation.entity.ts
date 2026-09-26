import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { School } from '../../schools/entities/school.entity';
import { AdmissionApplicant } from './admission-applicant.entity';
import { AdmissionEvaluationDecision } from '@biddaloy/shared';

/**
 * [27.1] A reviewer's decision on one `AdmissionApplicant`. Append-only —
 * a re-review adds a new row rather than editing the old one, so the
 * decision trail stays intact.
 *
 * Relations:
 * - @ManyToOne → School: tenant the evaluation belongs to
 * - @ManyToOne → AdmissionApplicant: the applicant being reviewed
 */
@Entity('admission_evaluations')
@Index(['tenant_id', 'applicant_id'])
export class AdmissionEvaluation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => AdmissionApplicant, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'applicant_id' })
  applicant: AdmissionApplicant;

  @Column({ type: 'uuid' })
  applicant_id: string;

  @Column({ type: 'uuid' })
  reviewer_user_id: string;

  @Column({ type: 'text' })
  notes: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  decision: AdmissionEvaluationDecision | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
