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

/**
 * A term/semester/trimester within an academic year (17.x) — the tenant's
 * own label for it lives in `region.calendar.termLabel`
 * (`CalendarSettings`, [17.1.1]). `seq` orders terms within a year (1, 2, 3…).
 *
 * The migration adds an exclusion constraint so two non-deleted terms in
 * the same academic year can never overlap in date range (D5):
 * `EXCLUDE USING gist (academic_year_id WITH =, daterange(start_date, end_date, '[]') WITH &&) WHERE (deleted_at IS NULL)`.
 * `(academic_year_id, seq)` is unique among non-deleted rows.
 */
@Entity('academic_terms')
@Index(['tenant_id', 'academic_year_id'])
export class AcademicTerm {
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

  @Column({ type: 'int' })
  seq: number;

  @Column({ type: 'varchar', length: 80 })
  name: string;

  @Column({ type: 'date' })
  start_date: string;

  @Column({ type: 'date' })
  end_date: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;
}
