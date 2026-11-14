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
import { AdmissionApplicant } from './admission-applicant.entity';
import { User } from '../../users/entities/user.entity';
import type { AdmissionFeeState, AdmissionPayMethod } from '@biddaloy/shared';

/**
 * [Epic 71 D9] A manual fee payment proof (screenshot + reference) for an applicant.
 *
 * Relations:
 * - @ManyToOne → School: tenant
 * - @ManyToOne → AdmissionApplicant: whose fee
 * - @ManyToOne → User: who verified it
 */
@Entity('admission_fee_proofs')
@Index(['tenant_id', 'applicant_id'])
export class AdmissionFeeProof {
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

  @Column({ type: 'text' })
  attachment_key: string;

  @Column({ type: 'varchar', length: 20 })
  method: AdmissionPayMethod;

  @Column({ type: 'varchar', length: 100, nullable: true })
  reference: string | null;

  @Column({ type: 'varchar', length: 20, default: 'AWAITING' })
  state: AdmissionFeeState;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'verified_by_user_id' })
  verified_by: User | null;

  @Column({ type: 'uuid', nullable: true })
  verified_by_user_id: string | null;

  @Column({ type: 'text', nullable: true })
  reason: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;
}
