import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { School } from '../../schools/entities/school.entity';

/** [28.1.2] One answer to one question (free text and/or 1-5 stars). */
@Entity('survey_answers')
@Index('IDX_survey_answers_tenant_response', ['tenant_id', 'response_id'])
export class SurveyAnswer {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  response_id: string;

  @Column({ type: 'uuid' })
  question_id: string;

  @Column({ type: 'text', nullable: true })
  text: string | null;

  @Column({ type: 'smallint', nullable: true })
  stars: number | null;
}
