import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
} from 'typeorm';
import { School } from '../../schools/entities/school.entity';
import { ExamKind } from '@biddaloy/shared';
import { ExamTemplateComponent } from './exam-template-component.entity';

/**
 * [35.1.3/#1266] A reusable exam shape: a named set of per-class,
 * per-subject components that can be stamped onto a real exam.
 *
 * `kind` reuses the `exams_kind_enum` pg type of `exams.kind`.
 *
 * Relations:
 * - @ManyToOne → School: tenant this template belongs to
 * - @OneToMany → ExamTemplateComponent: the components it defines
 */
@Entity('exam_templates')
@Index(['tenant_id'])
@Index(['tenant_id', 'name'], { unique: true, where: '"deleted_at" IS NULL' })
export class ExamTemplate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'enum', enum: ExamKind, enumName: 'exams_kind_enum' })
  kind: ExamKind;

  @OneToMany(() => ExamTemplateComponent, (c) => c.template)
  components: ExamTemplateComponent[];

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;
}
