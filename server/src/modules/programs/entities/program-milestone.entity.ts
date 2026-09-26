import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Unique,
} from 'typeorm';
import { School } from '../../schools/entities/school.entity';
import { Program } from './program.entity';

/**
 * [34.1.3] An ordered milestone within a `Program` (D15). `description` is
 * nullable free text. `sequence` orders milestones for display and reorder
 * (D23) — its uniqueness per program is `DEFERRABLE INITIALLY DEFERRED`
 * (matching `UQ_program_milestones_program_sequence` in
 * `1789800016000-CreatePrograms.ts`), so a reorder can swap two sequence
 * values inside one transaction without a transient collision. Declared
 * here explicitly rather than relying on `synchronize`/migration drift
 * detection to notice — this is the first deferrable constraint in the
 * repo and nothing else catches it.
 *
 * Deleting a milestone cascades its `MilestoneAchievement` rows (FK
 * `ON DELETE CASCADE`) — the service reports the achievement count first
 * so the caller can confirm (D23).
 *
 * Relations:
 * - @ManyToOne → School: tenant the milestone belongs to (denormalized
 *   from the parent program for tenant-scoped queries without a join)
 * - @ManyToOne → Program: the program this milestone belongs to
 * - Referenced-by → MilestoneAchievement: achievements of this milestone
 */
@Entity('program_milestones')
@Index(['tenant_id', 'program_id'])
@Unique('UQ_program_milestones_program_sequence', ['program_id', 'sequence'], {
  deferrable: 'INITIALLY DEFERRED',
})
export class ProgramMilestone {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => Program, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'program_id' })
  program: Program;

  @Column({ type: 'uuid' })
  program_id: string;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'int' })
  sequence: number;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
