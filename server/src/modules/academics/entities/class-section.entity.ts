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
 * in the same class). This unique index is untouched by [33.2.1] — it
 * stays scoped to `(class_id, section_name)`, so two groups cannot reuse
 * the same section name within one class.
 *
 * `group_name` [33.2.1]: free-text value validated on write against the
 * tenant's own vocabulary (`TenantSettings.organisation.groups`,
 * [33.1.1]). Named `group_name`, not `group`, because `group` is a SQL
 * reserved word — this avoids having to quote it in every query. `NULL`
 * means this tenant does not use groups — existing rows are left `NULL`,
 * no backfill.
 *
 * Relations:
 * - @ManyToOne → School: the tenant this section belongs to
 * - @ManyToOne → Class: the parent class
 * - Referenced-by → Student: students are enrolled in a specific section
 * - Referenced-by → FeeStructure: fees can be configured per-section
 * - Referenced-by → Teacher (via teacher_class_sections): teachers assigned to sections
 */
@Entity('class_sections')
@Index(['class_id', 'section_name'], { unique: true, where: '"deleted_at" IS NULL' })
@Index(['class_id', 'tenant_id'])
@Index(['tenant_id'])
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

  /** [33.2.1] Validated against `TenantSettings.organisation.groups`. `NULL` = tenant doesn't use groups. */
  @Column({ type: 'varchar', length: 50, nullable: true, name: 'group_name' })
  group_name: string | null;

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
