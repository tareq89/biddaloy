import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { School } from '../../schools/entities/school.entity';

/**
 * Defines the school calendar period (e.g., "2026-2027").
 *
 * All fee structures, class enrollments, and fee generations are scoped
 * to an academic year. Only one year can be marked is_current at a time
 * per tenant (enforced by a partial unique index).
 *
 * Relations:
 * - @ManyToOne → School: the tenant this academic year belongs to
 * - Referenced-by → Class: classes belong to an academic year
 * - Referenced-by → FeeStructure: fees are set per academic year
 * - Referenced-by → StudentFee: generated fees are tied to a year
 */
@Entity('academic_years')
@Index(['name', 'tenant_id'], { unique: true })
@Index(['is_current', 'tenant_id'], { unique: true, where: '"is_current" = true' })
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