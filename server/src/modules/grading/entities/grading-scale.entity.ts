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
import { AcademicYear } from '../../academics/entities/academic-year.entity';
import { Class } from '../../academics/entities/class.entity';

/**
 * [20.1.1] A grading scale — the set of percent-to-grade bands (see
 * `GradingBand`) applied when computing a result.
 *
 * `class_id` null means "this year's default scale" (D1); a non-null
 * `class_id` overrides the default for that one class. Only one default
 * scale may exist per (tenant, academic year) — enforced by a partial
 * unique index in the migration, since Postgres treats NULLs as distinct
 * and a plain unique constraint on (tenant_id, academic_year_id, class_id)
 * would let two default rows coexist.
 *
 * `revision` bumps whenever the scale's bands change after results have
 * been computed against it, so past results can still be read against the
 * band set that actually produced them (20.x, not this ticket). It is a
 * revision marker only — not a row version and not used for optimistic
 * locking.
 *
 * Relations:
 * - @ManyToOne → School: tenant the scale belongs to
 * - @ManyToOne → AcademicYear: year the scale applies to
 * - @ManyToOne → Class: optional per-class override (null = year default)
 * - Referenced-by → GradingBand: the scale's percent/grade bands
 */
@Entity('grading_scales')
@Index(['tenant_id', 'academic_year_id'])
export class GradingScale {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => AcademicYear, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'academic_year_id' })
  academic_year: AcademicYear;

  @Column({ type: 'uuid' })
  academic_year_id: string;

  @ManyToOne(() => Class, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'class_id' })
  class: Class | null;

  @Column({ type: 'uuid', nullable: true })
  class_id: string | null;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'int', default: 1 })
  revision: number;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;
}
