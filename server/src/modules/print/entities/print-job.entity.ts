import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import type { DocumentKind, PrintJobStatus } from '@biddaloy/shared';
import { School } from '../../schools/entities/school.entity';
import { User } from '../../users/entities/user.entity';
import { PrintTemplateVersion } from './print-template-version.entity';
import { PrinterProfile } from './printer-profile.entity';

/**
 * [32.1.2] One print run — the audit trail (Epic 32 D44). Pins the exact
 * template version used. `printer_name` is a snapshot so the record
 * survives the profile being deleted. Not part of the workbook: like
 * `audit_logs`, it must not travel to another tenant.
 */
@Entity('print_jobs')
@Index('IDX_print_jobs_tenant_created', ['tenant_id', 'created_at'])
export class PrintJob {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => PrintTemplateVersion, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'template_version_id' })
  template_version: PrintTemplateVersion;

  @Column({ type: 'uuid' })
  template_version_id: string;

  @Column({ type: 'varchar', length: 40 })
  document_kind: DocumentKind;

  @ManyToOne(() => PrinterProfile, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'printer_profile_id' })
  printer_profile: PrinterProfile | null;

  @Column({ type: 'uuid', nullable: true })
  printer_profile_id: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  printer_name: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'printed_by' })
  printed_by_user: User | null;

  @Column({ type: 'uuid', nullable: true })
  printed_by: string | null;

  @Column({ type: 'int' })
  item_count: number;

  @Column({ type: 'varchar', length: 20, default: 'OPEN' })
  status: PrintJobStatus;

  @Column({ type: 'timestamptz', nullable: true })
  confirmed_at: Date | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  batch_label: string | null;

  @ManyToOne(() => PrintJob, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'reprint_of_job_id' })
  reprint_of_job: PrintJob | null;

  @Column({ type: 'uuid', nullable: true })
  reprint_of_job_id: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
