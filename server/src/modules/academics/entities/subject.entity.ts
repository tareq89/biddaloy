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
import { School } from '../../schools/entities/school.entity';

/**
 * A subject a school teaches (e.g., "Mathematics", "Bangla").
 *
 * Tenant-scoped: two schools can each have their own "MATH" code without
 * clashing. `ClassSubject` says which subjects a class offers in a given
 * academic year; `TeacherClassSection.subject_id` says which subject a
 * teacher teaches in a section.
 *
 * Relations:
 * - @ManyToOne → School: the tenant this subject belongs to
 * - Referenced-by → ClassSubject: classes this subject is offered under
 * - Referenced-by → TeacherClassSection: sections a teacher teaches this
 *   subject in
 */
@Entity('subjects')
@Index(['tenant_id'])
@Index(['tenant_id', 'code'], { unique: true, where: '"deleted_at" IS NULL' })
export class Subject {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'varchar', length: 100 })
  name_en: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  name_bn: string | null;

  @Column({ type: 'varchar', length: 20 })
  code: string;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;
}
