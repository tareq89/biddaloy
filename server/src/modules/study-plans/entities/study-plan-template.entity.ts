import {
  Check,
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
import type { StudyPlanTemplateLesson } from '@biddaloy/shared';
import { School } from '../../schools/entities/school.entity';

/**
 * [66.1.03/#2001] A reusable lesson list for a class grade + subject code,
 * with no topic links (topics are per class and year, D4).
 *
 * Relations:
 * - @ManyToOne → School: tenant this template belongs to
 */
@Entity('study_plan_templates')
@Index('UQ_study_plan_templates_name', ['tenant_id', 'name'], {
  unique: true,
  where: '"deleted_at" IS NULL',
})
@Index('IDX_study_plan_templates_key', ['tenant_id', 'class_grade', 'subject_code'])
@Check('CHK_study_plan_templates_json', `jsonb_typeof("lessons") = 'array'`)
export class StudyPlanTemplate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'int' })
  class_grade: number;

  @Column({ type: 'varchar', length: 20 })
  subject_code: string;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  lessons: StudyPlanTemplateLesson[];

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;
}
