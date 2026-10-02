import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { School } from '../../schools/entities/school.entity';

/** [28.1.2] One criterion score (1-4, enforced by a migration CHECK). */
@Entity('acr_scores')
@Index('IDX_acr_scores_tenant_assessment', ['tenant_id', 'assessment_id'])
@Index('UQ_acr_scores_assessment_criterion', ['assessment_id', 'criterion_id'], { unique: true })
export class AcrScore {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  assessment_id: string;

  @Column({ type: 'uuid' })
  criterion_id: string;

  @Column({ type: 'smallint' })
  score: number;
}
