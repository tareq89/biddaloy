import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { School } from '../../schools/entities/school.entity';
import { User } from '../../users/entities/user.entity';

/** What the job produces or consumes. EXPORT writes a workbook the user
 * downloads, SNAPSHOT writes one the system keeps for restore, RESTORE
 * reads one back into the tenant's data. */
export enum WorkbookJobKind {
  EXPORT = 'EXPORT',
  SNAPSHOT = 'SNAPSHOT',
  RESTORE = 'RESTORE',
}

/** Lifecycle. DELETED means the artefact was pruned or removed but the
 * record is kept as history — it is a terminal state, not a soft delete,
 * so there is no `deleted_at` column and no `@DeleteDateColumn`. */
export enum WorkbookJobStatus {
  QUEUED = 'QUEUED',
  RUNNING = 'RUNNING',
  DONE = 'DONE',
  FAILED = 'FAILED',
  DELETED = 'DELETED',
}

/** Who or what started the job. MANUAL is a user action, SCHEDULED is the
 * nightly cron, SNAPSHOT is the automatic pre-restore safety copy. */
export enum WorkbookJobSource {
  MANUAL = 'MANUAL',
  SCHEDULED = 'SCHEDULED',
  SNAPSHOT = 'SNAPSHOT',
}

/** Per-tab row counts of a finished workbook, e.g. `{ students: 412 }`. */
export type WorkbookRowCounts = Record<string, number>;

/** Coarse progress of a running job: which tab, how far through it. */
export interface WorkbookJobProgress {
  tab: string;
  done: number;
  total: number;
}

/**
 * One row per export, snapshot or restore. This is the single history
 * table for Epic 14.0's backup surface: the list screen reads it, the
 * worker updates `status`/`progress` as it goes, and retention prunes by
 * `expires_at` unless `pinned`.
 *
 * Relations:
 * - @ManyToOne → School (required): the tenant the job belongs to. Every
 *   read must filter on `tenant_id`; there is no other scoping.
 * - @ManyToOne → User (optional): who asked for it. Null for SCHEDULED
 *   and SNAPSHOT jobs, and set to null if the user is later deleted.
 *
 * `snapshot_job_id` is deliberately NOT a foreign key — see the column.
 */
@Entity('workbook_jobs')
@Index('IDX_workbook_jobs_tenant_created', ['tenant_id', 'created_at'])
@Index('IDX_workbook_jobs_tenant_kind_status', ['tenant_id', 'kind', 'status'])
export class WorkbookJob {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'enum', enum: WorkbookJobKind })
  kind: WorkbookJobKind;

  @Column({ type: 'enum', enum: WorkbookJobStatus, default: WorkbookJobStatus.QUEUED })
  status: WorkbookJobStatus;

  @Column({ type: 'enum', enum: WorkbookJobSource, default: WorkbookJobSource.MANUAL })
  source: WorkbookJobSource;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'requested_by_user_id' })
  requested_by: User | null;

  @Column({ type: 'uuid', nullable: true })
  requested_by_user_id: string | null;

  /** Object-storage key of the produced workbook. Null until DONE, and
   * again once the artefact is pruned (status DELETED). */
  @Column({ type: 'text', nullable: true })
  storage_key: string | null;

  // bigint, so node-postgres hands it back as a string, not a number —
  // see the plan's correction C2. Do not retype this as `number`.
  @Column({ type: 'bigint', nullable: true })
  size_bytes: string | null;

  /** `{ [tab]: rowCount }` of the finished workbook. */
  @Column({ type: 'jsonb', nullable: true })
  row_counts: WorkbookRowCounts | null;

  /** Coarse progress while RUNNING; left at its last value on FAILED so
   * the UI can say which tab it died on. */
  @Column({ type: 'jsonb', nullable: true })
  progress: WorkbookJobProgress | null;

  /** Restore only: the staging area holding the uploaded workbook while
   * it is validated. Opaque string, not a DB reference. */
  @Column({ type: 'text', nullable: true })
  staging_id: string | null;

  /** Restore only: the SNAPSHOT job taken before this restore, so the
   * user can roll back. A loose pointer, NOT a foreign key — the
   * snapshot may be pruned while this history row must survive. */
  @Column({ type: 'uuid', nullable: true })
  snapshot_job_id: string | null;

  /** Which tab the job failed on, if any. */
  @Column({ type: 'text', nullable: true })
  failed_tab: string | null;

  /** Sanitised, user-facing failure reason. Never a stack trace and never
   * raw driver output — both can leak table names, SQL and tenant data. */
  @Column({ type: 'text', nullable: true })
  error: string | null;

  /** Pinned rows are exempt from retention pruning. */
  @Column({ type: 'boolean', default: false })
  pinned: boolean;

  /** When retention may prune the artefact. Null means "not subject to
   * retention" (e.g. a manual export the user still has to download). */
  @Column({ type: 'timestamptz', nullable: true })
  expires_at: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  /** Set once the job reaches DONE or FAILED. */
  @Column({ type: 'timestamptz', nullable: true })
  finished_at: Date | null;
}
