import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  ManyToOne,
  JoinColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { AcademicYear } from './academic-year.entity';
import { ClassSection } from './class-section.entity';
import { School } from '../../schools/entities/school.entity';

/**
 * A grade/standard within an academic year (e.g., "Class 10", "Grade 5").
 *
 * Classes are unique per academic year + tenant + shift + version, with
 * NULL shift/version treated as one more distinct value rather than as
 * "don't care" (`NULLS NOT DISTINCT`, `1789800010700-AddOrganisationDimensions.ts`).
 * That migration is the source of truth for the index — TypeORM's
 * `@Index` decorator cannot express `NULLS NOT DISTINCT`, so it is not
 * declared here to avoid drifting from the actual DB schema.
 * Each class has multiple sections (e.g., "A", "B").
 *
 * `shift`/`version` [33.2.1]: free-text values validated on write against
 * the tenant's own vocabulary (`TenantSettings.organisation.shifts` /
 * `.versions`, [33.1.1]). `NULL` means this tenant does not use that
 * dimension — existing rows are left `NULL`, no backfill.
 *
 * Relations:
 * - @ManyToOne → School: the tenant this class belongs to
 * - @ManyToOne → AcademicYear: the year this class belongs to
 * - @OneToMany → ClassSection: sections under this class
 * - Referenced-by → FeeStructure: fees are configured per class
 */
@Entity('classes')
@Index(['tenant_id'])
export class Class {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 50 })
  name: string;

  @Column({ type: 'int', nullable: true })
  numeric_grade: number | null;

  /** [33.2.1] Validated against `TenantSettings.organisation.shifts`. `NULL` = tenant doesn't use shifts. */
  @Column({ type: 'varchar', length: 50, nullable: true })
  shift: string | null;

  /** [33.2.1] Validated against `TenantSettings.organisation.versions`. `NULL` = tenant doesn't use versions. */
  @Column({ type: 'varchar', length: 50, nullable: true })
  version: string | null;

  @ManyToOne(() => AcademicYear, { nullable: false })
  @JoinColumn({ name: 'academic_year_id' })
  academic_year: AcademicYear;

  @Column({ type: 'uuid' })
  academic_year_id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @OneToMany(() => ClassSection, (section) => section.class)
  sections: ClassSection[];

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;
}
