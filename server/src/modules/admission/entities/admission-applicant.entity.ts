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
import type { AdmissionApplicantStatus, AdmissionApplicantDocument } from '@biddaloy/shared';

// Dynamic require, not `import { AdmissionApplicantStatus } from '@biddaloy/shared'`:
// see `common/decorators/sanitize-text.decorator.ts`'s comment — under this repo's
// vitest config a static named import of a shared enum added after the original
// four barrel exports binds to `undefined`, which breaks `@Column({ default: ... })`
// here specifically since TypeORM's entity glob loads this file via ts-node at
// vitest's global-setup time, ahead of vitest's own module graph.
const shared = require('@biddaloy/shared') as typeof import('@biddaloy/shared');

/**
 * [27.1] A candidate applying against one `AdmissionIntake`.
 *
 * `reference_number` is unique per tenant (the number an applicant/guardian
 * quotes to check status). `(tenant_id, intake_id, guardian_phone)` is
 * unique too, across every status — one application per guardian phone per
 * intake, for the life of that intake. `AdmissionApplicantService.submit`'s
 * duplicate lookup matches this: it compares phones through
 * `normalizeBdPhoneNumber` (so "01712345678" and "+8801712345678" collide
 * on the same row rather than bypassing this index), and requires the
 * caller to supply the existing row's `reference_number` before updating a
 * PENDING one in place — a phone number and `intake_id` are both public,
 * so matching on those two alone would let anyone overwrite someone else's
 * pending application. Any other status (SHORTLISTED/ADMITTED/REJECTED)
 * rejects a resubmission with a 409 rather than letting the insert hit
 * this index. A guardian with more than one child applying to the same
 * intake needs a distinct phone number per child.
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

  @Column({ type: 'varchar', length: 20, default: shared.AdmissionApplicantStatus.PENDING })
  status: AdmissionApplicantStatus;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;
}
