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
import type { AdmissionListKind, AdmissionListOrder } from '@biddaloy/shared';

/**
 * [Epic 71 D3] A published result list (merit or waiting) of a round.
 *
 * Relations:
 * - @ManyToOne → School: tenant
 * - @ManyToOne → AdmissionIntake: the round
 * - Referenced-by → AdmissionListMember: who is on the list
 */
@Entity('admission_lists')
@Index('UQ_admission_lists_sequence', ['tenant_id', 'intake_id', 'kind', 'sequence'], {
  unique: true,
  where: '"deleted_at" IS NULL',
})
export class AdmissionList {
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

  @Column({ type: 'varchar', length: 20 })
  kind: AdmissionListKind;

  @Column({ type: 'int' })
  sequence: number;

  @Column({ type: 'varchar', length: 20 })
  order_by: AdmissionListOrder;

  @Column({ type: 'boolean', default: false })
  active: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  published_at: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;
}
