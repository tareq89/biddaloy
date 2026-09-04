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
import { AcademicYear } from './academic-year.entity';

/**
 * A calendar entry — holiday, exam day, or school event — that [9.4]'s
 * working-day math reads to compute attendance denominators. This is an
 * academics/calendar concern, not an attendance one: attendance only ever
 * reads it.
 *
 * `start_date`/`end_date` is an inclusive range; a one-day holiday sets
 * both the same. The migration adds `CHECK ("start_date" <= "end_date")`.
 *
 * `counts_as_working_day` exists because not every calendar entry removes
 * a day from the denominator — an exam day or a school event is on the
 * calendar but *is* a working day.
 *
 * Relations:
 * - @ManyToOne → School: the tenant this holiday belongs to
 * - @ManyToOne → AcademicYear: the year this holiday falls within
 */
@Entity('school_holidays')
@Index(['tenant_id', 'start_date', 'end_date'])
export class SchoolHoliday {
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

  @Column({ type: 'date' })
  start_date: string;

  @Column({ type: 'date' })
  end_date: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'boolean', default: false })
  counts_as_working_day: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;
}
