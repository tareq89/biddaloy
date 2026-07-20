import {
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
import { Class } from './class.entity';
import { School } from '../../schools/entities/school.entity';

/**
 * A division within a class (e.g., "Section A", "Morning Batch").
 *
 * Section names are unique within a class (cannot have two "A" sections
 * in the same class).
 *
 * Relations:
 * - @ManyToOne → School: the tenant this section belongs to
 * - @ManyToOne → Class: the parent class
 * - Referenced-by → Student: students are enrolled in a specific section
 * - Referenced-by → FeeStructure: fees can be configured per-section
 * - Referenced-by → Teacher (via teacher_class_sections): teachers assigned to sections
 */
@Entity('class_sections')
@Index(['class_id', 'section_name'], { unique: true })
export class ClassSection {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Class, (c) => c.sections, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'class_id' })
  class: Class;

  @Column({ type: 'uuid' })
  class_id: string;

  @Column({ type: 'varchar', length: 20 })
  section_name: string;

  @Column({ type: 'int', nullable: true })
  capacity: number | null;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;
}