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
import type { AdmissionStageKind } from '@biddaloy/shared';

/**
 * [Epic 71 D1] One step of a round's pipeline (written test, viva, lottery...).
 * Old rounds get a single `NONE` stage in the migration.
 *
 * Relations:
 * - @ManyToOne → School: tenant
 * - @ManyToOne → AdmissionIntake: the round this stage belongs to
 * - Referenced-by → AdmissionStageResult: per-applicant outcome of the stage
 */
@Entity('admission_stages')
@Index('UQ_admission_stages_position', ['tenant_id', 'intake_id', 'position'], {
  unique: true,
  where: '"deleted_at" IS NULL',
})
export class AdmissionStage {
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

  @Column({ type: 'int' })
  position: number;

  @Column({ type: 'varchar', length: 20 })
  kind: AdmissionStageKind;

  @Column({ type: 'varchar', length: 200, nullable: true })
  title: string | null;

  /** Kind-specific settings (pass mark, full marks, date...). */
  @Column({ type: 'jsonb', default: () => "'{}'" })
  config: Record<string, unknown>;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;
}
