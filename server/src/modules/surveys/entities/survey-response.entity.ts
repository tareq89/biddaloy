import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { School } from '../../schools/entities/school.entity';

/**
 * [28.1.2] One respondent's answer set for one (teacher, subject) target (D11:
 * unique per survey+respondent+teacher+subject). `respondent_user_id` is
 * privacy-sensitive: never expose it on anonymous surveys.
 */
@Entity('survey_responses')
@Index('IDX_survey_responses_tenant_survey', ['tenant_id', 'survey_id'])
@Index(
  'UQ_survey_responses_once',
  ['survey_id', 'respondent_user_id', 'teacher_id', 'subject_id'],
  { unique: true },
)
export class SurveyResponse {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  survey_id: string;

  @Column({ type: 'uuid' })
  respondent_user_id: string;

  @Column({ type: 'uuid' })
  teacher_id: string;

  @Column({ type: 'uuid' })
  subject_id: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
