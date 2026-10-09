import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import type { TemplateDefinition } from '@biddaloy/shared';
import { School } from '../../schools/entities/school.entity';
import { User } from '../../users/entities/user.entity';
import { PrintTemplate } from './print-template.entity';

/**
 * [32.1.2] An immutable published snapshot of a template (Epic 32 D38, D40).
 * A DB trigger (`trg_print_template_versions_immutable`) rejects every
 * UPDATE, so print jobs can always reproduce exactly what was printed.
 * Deleting the parent template is RESTRICTed while versions exist.
 */
@Entity('print_template_versions')
@Index(['tenant_id'])
@Index('UQ_print_template_versions_template_version', ['template_id', 'version'], {
  unique: true,
})
export class PrintTemplateVersion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => PrintTemplate, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'template_id' })
  template: PrintTemplate;

  @Column({ type: 'uuid' })
  template_id: string;

  @Column({ type: 'int' })
  version: number;

  @Column({ type: 'jsonb' })
  definition: TemplateDefinition;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'published_by' })
  published_by_user: User | null;

  @Column({ type: 'uuid', nullable: true })
  published_by: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  published_at: Date;
}
