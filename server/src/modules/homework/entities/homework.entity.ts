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
import { Subject } from '../../academics/entities/subject.entity';
import { Class } from '../../academics/entities/class.entity';
import { School } from '../../schools/entities/school.entity';
import { HomeworkGradingMode } from '@biddaloy/shared';

/**
 * One homework given for a subject/class (Epic 22.0, D11). `grading_mode`
 * is fixed at creation — how completion is graded never changes mid-flight.
 *
 * Relations:
 * - @ManyToOne → Subject: the subject this homework is for
 * - @ManyToOne → Class: the class this homework is for
 * - @ManyToOne → School: the tenant this homework belongs to
 * - Referenced-by → HomeworkAssignment: who/which section this is assigned to
 */
@Entity('homework')
@Index(['tenant_id'])
export class Homework {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @ManyToOne(() => Subject, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'subject_id' })
  subject: Subject;

  @Column({ type: 'uuid' })
  subject_id: string;

  @ManyToOne(() => Class, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'class_id' })
  klass: Class;

  @Column({ type: 'uuid' })
  class_id: string;

  @Column({ type: 'enum', enum: HomeworkGradingMode })
  grading_mode: HomeworkGradingMode;

  @Column({ type: 'jsonb', default: [] })
  attachments: unknown[];

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
