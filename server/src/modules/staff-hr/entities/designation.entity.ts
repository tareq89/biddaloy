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
 * A tenant-editable job title (e.g. "Assistant Teacher", "Accountant"). One
 * designation may or may not be teaching staff (`is_teaching`) — 23.1 D9.
 *
 * Unique on `(tenant_id, title_en)` excluding soft-deleted rows, same
 * pattern as `class_subjects`' partial unique index.
 */
@Entity('designations')
@Index(['tenant_id'])
@Index(['tenant_id', 'title_en'], { unique: true, where: '"deleted_at" IS NULL' })
export class Designation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'varchar', length: 200 })
  title_en: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  title_bn: string | null;

  @Column({ type: 'boolean', default: false })
  is_teaching: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;
}
