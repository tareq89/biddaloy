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
  Check,
} from 'typeorm';
import { School } from '../../schools/entities/school.entity';
import { AdmissionIntake } from './admission-intake.entity';
import type { AdmissionListKind, AdmissionListOrder } from '@biddaloy/shared';

/** What a FILTER list was built with (kept for the Lists screen). */
export interface ListFilter {
  quota_tags?: string[];
  min_score?: number;
  gender?: string;
}

/**
 * [Epic 71 D3] A published result list (merit or waiting) of a round.
 *
 * Relations:
 * - @ManyToOne → School: tenant
 * - @ManyToOne → AdmissionIntake: the round
 * - Referenced-by → AdmissionListMember: who is on the list
 */
@Entity('admission_lists')
@Check('CHK_admission_lists_capacity', '"capacity" >= 0')
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

  /** Seats this list offers when it is activated. */
  @Column({ type: 'int', default: 0 })
  capacity: number;

  /** Offers lapse after this day (YYYY-MM-DD, school time). */
  @Column({ type: 'date', nullable: true })
  act_by_date: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  activated_at: Date | null;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  filter: ListFilter;

  /** True once the list has been activated (`activated_at` is set). */
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
