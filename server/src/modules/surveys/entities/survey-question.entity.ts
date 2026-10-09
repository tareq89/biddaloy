import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { School } from '../../schools/entities/school.entity';

/** [28.1.2] One question on a survey. */
@Entity('survey_questions')
@Index('IDX_survey_questions_tenant_survey', ['tenant_id', 'survey_id'])
export class SurveyQuestion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  survey_id: string;

  @Column({ type: 'integer', default: 0 })
  sort_order: number;

  @Column({ type: 'text' })
  text: string;

  @Column({ type: 'boolean', default: true })
  stars_enabled: boolean;
}
