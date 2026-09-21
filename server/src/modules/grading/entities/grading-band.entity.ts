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
import { GradingScale } from './grading-scale.entity';

/**
 * [20.1.1] One percent-range band within a `GradingScale` — e.g.
 * "80-100% → A+, GPA 5.0".
 *
 * `gpa` is nullable (D4): some scales grade with letters only and never
 * compute a GPA. `sequence` orders bands for display (highest grade
 * first), independent of `percent_from`/`percent_to`), and is unique per
 * scale — two bands in the same scale can never claim the same slot.
 *
 * Soft-deletes (`deleted_at`), same as its parent `GradingScale`: a band
 * removed from a scale that already produced results must stay readable
 * against those past results, not disappear.
 *
 * Relations:
 * - @ManyToOne → School: tenant the band belongs to (denormalized from
 *   the parent scale for tenant-scoped queries without a join)
 * - @ManyToOne → GradingScale: the scale this band belongs to
 */
@Entity('grading_bands')
@Index(['tenant_id', 'scale_id'])
@Index(['scale_id', 'sequence'], { unique: true })
export class GradingBand {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => GradingScale, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'scale_id' })
  scale: GradingScale;

  @Column({ type: 'uuid' })
  scale_id: string;

  @Column({ type: 'int' })
  percent_from: number;

  @Column({ type: 'int' })
  percent_to: number;

  @Column({ type: 'varchar', length: 10 })
  grade: string;

  @Column({ type: 'numeric', precision: 4, scale: 2, nullable: true })
  gpa: string | null;

  @Column({ type: 'boolean', default: false })
  is_fail: boolean;

  @Column({ type: 'int' })
  sequence: number;

  @Column({ type: 'varchar', nullable: true })
  comment: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;
}
