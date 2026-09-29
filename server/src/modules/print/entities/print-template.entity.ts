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
import type { DocumentKind, LayoutKind, TemplateDefinition } from '@biddaloy/shared';
import { School } from '../../schools/entities/school.entity';
import { User } from '../../users/entities/user.entity';

/**
 * [32.1.2] A printable template's editable draft (Epic 32 D17, D38, D40).
 * Publishing copies `draft` into an immutable `PrintTemplateVersion` and
 * points `current_version_id` at it. At most one non-archived default per
 * (tenant, document_kind); names are unique per tenant, case-insensitively.
 * The two partial unique indexes live in the migration.
 */
@Entity('print_templates')
@Index(['tenant_id'])
export class PrintTemplate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'varchar', length: 40 })
  document_kind: DocumentKind;

  @Column({ type: 'varchar', length: 20, default: 'FIXED' })
  layout_kind: LayoutKind;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'boolean', default: false })
  is_default: boolean;

  @Column({ type: 'int', default: 50 })
  batch_size: number;

  @Column({ type: 'jsonb' })
  draft: TemplateDefinition;

  @Column({ type: 'uuid', nullable: true })
  current_version_id: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by' })
  created_by_user: User | null;

  @Column({ type: 'uuid', nullable: true })
  created_by: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  archived_at: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
