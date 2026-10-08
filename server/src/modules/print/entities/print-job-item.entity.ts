import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import type {
  DocumentKind,
  PrintContextType,
  PrintItemOutcome,
  PrintSubjectType,
} from '@biddaloy/shared';
import { School } from '../../schools/entities/school.entity';
import { User } from '../../users/entities/user.entity';
import { PrintJob } from './print-job.entity';

/**
 * [32.1.2] One printed document within a job (Epic 32 D44, D46, D49).
 * `data_snapshot` freezes exactly what was printed. Only the SHA-256 hash of
 * the verify token is stored (`verify_token_hash`, char(64), globally
 * unique). Copy numbers are unique per two keys (Epic 48 D41): without a
 * serial, `(tenant, subject, kind, context, copy)`; with a serial,
 * `(tenant, kind, serial_year, serial_no, copy)`. Not part of
 * the workbook: verify tokens must not travel to another tenant.
 */
@Entity('print_job_items')
@Index(['tenant_id'])
@Index('IDX_print_job_items_subject', ['tenant_id', 'subject_type', 'subject_id'])
// The migration (NULLS NOT DISTINCT) is the source of truth for this index; @Index cannot express it.
@Index(
  'UQ_print_job_items_copy',
  [
    'tenant_id',
    'subject_type',
    'subject_id',
    'document_kind',
    'context_type',
    'context_id',
    'copy_number',
  ],
  { unique: true, where: '"serial_no" IS NULL' },
)
@Index(
  'UQ_print_job_items_serial_copy',
  ['tenant_id', 'document_kind', 'serial_year', 'serial_no', 'copy_number'],
  { unique: true, where: '"serial_no" IS NOT NULL' },
)
export class PrintJobItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => PrintJob, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'job_id' })
  job: PrintJob;

  @Column({ type: 'uuid' })
  job_id: string;

  @Column({ type: 'varchar', length: 40 })
  document_kind: DocumentKind;

  @Column({ type: 'varchar', length: 20 })
  subject_type: PrintSubjectType;

  @Column({ type: 'uuid', nullable: true })
  subject_id: string | null;

  @Column({ type: 'varchar', length: 200 })
  subject_label: string;

  @Column({ type: 'int' })
  copy_number: number;

  @Column({ type: 'int', nullable: true })
  serial_no: number | null;

  @Column({ type: 'smallint', nullable: true })
  serial_year: number | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  context_type: PrintContextType | null;

  @Column({ type: 'uuid', nullable: true })
  context_id: string | null;

  @Column({ type: 'jsonb' })
  data_snapshot: Record<string, unknown>;

  @Index('UQ_print_job_items_verify_token', { unique: true })
  @Column({ type: 'char', length: 64 })
  verify_token_hash: string;

  @Column({ type: 'varchar', length: 20, default: 'PENDING' })
  outcome: PrintItemOutcome;

  @Column({ type: 'timestamptz', nullable: true })
  revoked_at: Date | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'revoked_by' })
  revoked_by_user: User | null;

  @Column({ type: 'uuid', nullable: true })
  revoked_by: string | null;

  @Column({ type: 'varchar', length: 280, nullable: true })
  revoke_reason: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
