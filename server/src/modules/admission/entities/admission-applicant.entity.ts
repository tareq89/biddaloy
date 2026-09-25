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
import { AdmissionIntake } from './admission-intake.entity';
import { AdmissionApplicantStatus, AdmissionApplicantDocument } from '@biddaloy/shared';

/**
 * [27.1] A candidate applying against one `AdmissionIntake`.
 *
 * `reference_number` is unique per tenant (the number an applicant/guardian
 * quotes to check status). `(tenant_id, intake_id, guardian_phone)` is
 * unique too — one application per guardian phone per intake, so the same
 * family can't submit duplicate applications for the same seat window.
 *
 * Relations:
 * - @ManyToOne → School: tenant the applicant belongs to
 * - @ManyToOne → AdmissionIntake: the intake applied against
 * - Referenced-by → AdmissionEvaluation: review decisions on this applicant
 */
@Entity('admission_applicants')
@Index(['tenant_id', 'intake_id'])
@Index(['tenant_id', 'reference_number'], { unique: true })
@Index(['tenant_id', 'intake_id', 'guardian_phone'], {
  unique: true,
  where: '"deleted_at" IS NULL',
})
export class AdmissionApplicant {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => AdmissionIntake, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'intake_id' })
  intake: AdmissionIntake;

  @Column({ type: 'uuid' })
  intake_id: string;

  @Column({ type: 'varchar', length: 50 })
  reference_number: string;

  @Column({ type: 'varchar', length: 200 })
  applicant_name: string;

  @Column({ type: 'date' })
  date_of_birth: string;

  @Column({ type: 'varchar', length: 20 })
  gender: string;

  @Column({ type: 'varchar', length: 200 })
  guardian_name: string;

  @Column({ type: 'varchar', length: 20 })
  guardian_phone: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  guardian_email: string | null;

  @Column({ type: 'text', nullable: true })
  home_address: string | null;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  documents: AdmissionApplicantDocument[];

  @Column({ type: 'varchar', length: 20, default: AdmissionApplicantStatus.PENDING })
  status: AdmissionApplicantStatus;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;
}
