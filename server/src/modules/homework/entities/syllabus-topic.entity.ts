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
import { Class } from '../../academics/entities/class.entity';
import { Subject } from '../../academics/entities/subject.entity';
import { School } from '../../schools/entities/school.entity';
import { SyllabusTopicStatus } from '@biddaloy/shared';

/**
 * One syllabus topic for a class/subject, ordered by `sequence` (D19).
 *
 * Relations:
 * - @ManyToOne → Class: the class this topic belongs to
 * - @ManyToOne → Subject: the subject this topic belongs to
 * - @ManyToOne → School: the tenant this topic belongs to
 */
@Entity('syllabus_topics')
@Index(['tenant_id'])
@Index(['class_id', 'subject_id'])
export class SyllabusTopic {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Class, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'class_id' })
  klass: Class;

  @Column({ type: 'uuid' })
  class_id: string;

  @ManyToOne(() => Subject, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'subject_id' })
  subject: Subject;

  @Column({ type: 'uuid' })
  subject_id: string;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'int' })
  sequence: number;

  @Column({ type: 'enum', enum: SyllabusTopicStatus, default: SyllabusTopicStatus.PLANNED })
  status: SyllabusTopicStatus;

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
