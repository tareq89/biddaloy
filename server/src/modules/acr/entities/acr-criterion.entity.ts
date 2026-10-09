import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { School } from '../../schools/entities/school.entity';

export type AcrCriterionBlock = 'BLOCK_2' | 'BLOCK_3';

/** [28.1.2] One scored line of an ACR form version. */
@Entity('acr_criteria')
@Index('IDX_acr_criteria_tenant_form', ['tenant_id', 'form_version_id'])
export class AcrCriterion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  form_version_id: string;

  @Column({ type: 'varchar', length: 20 })
  block: AcrCriterionBlock;

  @Column({ type: 'varchar', length: 50 })
  code: string;

  @Column({ type: 'text' })
  label_en: string;

  @Column({ type: 'text' })
  label_bn: string;

  @Column({ type: 'integer', default: 0 })
  sort_order: number;
}
