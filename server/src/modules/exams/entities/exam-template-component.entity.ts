import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { School } from '../../schools/entities/school.entity';
import { ExamComponentKind } from '@biddaloy/shared';
import { ExamTemplate } from './exam-template.entity';

/**
 * [35.1.3/#1266] One component line of an exam template, keyed by class
 * grade and subject code (not ids, so a template applies to any
 * class/subject by code). Still tenant-scoped: `tenant_id` must come from the
 * parent template. `kind` reuses the `exam_components_kind_enum` pg type. A DB
 * CHECK enforces `full_marks > 0 AND 0 <= pass_marks <= full_marks`.
 *
 * Relations:
 * - @ManyToOne → School: tenant this row belongs to
 * - @ManyToOne → ExamTemplate: owning template (ON DELETE CASCADE)
 */
@Entity('exam_template_components')
@Index(['tenant_id', 'template_id'])
@Index(['template_id', 'class_grade', 'subject_code', 'name'], { unique: true })
export class ExamTemplateComponent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => ExamTemplate, (t) => t.components, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'template_id' })
  template: ExamTemplate;

  @Column({ type: 'uuid' })
  template_id: string;

  @Column({ type: 'int' })
  class_grade: number;

  @Column({ type: 'varchar', length: 20 })
  subject_code: string;

  @Column({ type: 'int' })
  sequence: number;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'enum', enum: ExamComponentKind, enumName: 'exam_components_kind_enum' })
  kind: ExamComponentKind;

  @Column({ type: 'numeric', precision: 6, scale: 2 })
  full_marks: string;

  @Column({ type: 'numeric', precision: 6, scale: 2 })
  pass_marks: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
