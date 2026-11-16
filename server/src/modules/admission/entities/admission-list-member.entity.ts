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
import { AdmissionList } from './admission-list.entity';
import { AdmissionApplicant } from './admission-applicant.entity';

/**
 * [Epic 71 D3] One applicant's place on one list.
 *
 * Relations:
 * - @ManyToOne → School: tenant
 * - @ManyToOne → AdmissionList / AdmissionApplicant
 */
@Entity('admission_list_members')
@Index('UQ_admission_list_members_applicant', ['tenant_id', 'list_id', 'applicant_id'], {
  unique: true,
  where: '"deleted_at" IS NULL',
})
export class AdmissionListMember {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => AdmissionList, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'list_id' })
  list: AdmissionList;

  @Column({ type: 'uuid' })
  list_id: string;

  @ManyToOne(() => AdmissionApplicant, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'applicant_id' })
  applicant: AdmissionApplicant;

  @Column({ type: 'uuid' })
  applicant_id: string;

  @Column({ type: 'int' })
  position: number;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;
}
