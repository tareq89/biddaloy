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
import { School } from '../../schools/entities/school.entity';

/**
 * [34.1.3] A tenant-wide program (e.g. a hifz or scouting track). No
 * `academic_year_id` — programs aren't year-scoped (D2). No `kind` column
 * (D6). Hard-deletable only when it has zero enrolments (D23); otherwise
 * archived via `is_active = false` (D27).
 *
 * Relations:
 * - @ManyToOne → School: tenant the program belongs to
 * - Referenced-by → ProgramMilestone: the program's ordered milestones
 * - Referenced-by → ProgramEnrollment: students enrolled in the program
 */
@Entity('programs')
@Index(['tenant_id'])
@Index(['tenant_id', 'name'], { unique: true })
export class Program {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @Column({ type: 'boolean', default: false })
  show_on_report_card: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
