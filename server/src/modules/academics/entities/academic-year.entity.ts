import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * Defines the school calendar period (e.g., "2026-2027").
 *
 * All fee structures, class enrollments, and fee generations are scoped
 * to an academic year. Only one year can be marked is_current at a time
 * (enforced by a partial unique index).
 *
 * Relations:
 * - Referenced-by → Class: classes belong to an academic year
 * - Referenced-by → FeeStructure: fees are set per academic year
 * - Referenced-by → StudentFee: generated fees are tied to a year
 */
@Entity('academic_years')
@Index(['name'], { unique: true })
@Index(['is_current'], { unique: true, where: 'is_current = true' })
export class AcademicYear {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 50 })
  name: string;

  @Column({ type: 'date' })
  start_date: Date;

  @Column({ type: 'date' })
  end_date: Date;

  @Column({ type: 'boolean', default: false })
  is_current: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}