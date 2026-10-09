import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { School } from '../../schools/entities/school.entity';

/** [28.1.2] A (teacher, subject) pair a survey asks respondents to rate. */
@Entity('survey_targets')
@Index('IDX_survey_targets_tenant_survey', ['tenant_id', 'survey_id'])
@Index('UQ_survey_targets_survey_teacher_subject', ['survey_id', 'teacher_id', 'subject_id'], {
  unique: true,
})
export class SurveyTarget {
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
  teacher_id: string;

  @Column({ type: 'uuid' })
  subject_id: string;
}
