import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Unique,
} from 'typeorm';
import { School } from '../../../schools/entities/school.entity';
import { User } from '../../../users/entities/user.entity';

/** Ledger row kind. GRANT adds credits (e.g. top-up), RESERVE/RELEASE
 * hold and free units around a send, DEBIT consumes them on delivery,
 * ADJUST is a signed manual correction. */
export enum SmsCreditLedgerKind {
  GRANT = 'GRANT',
  RESERVE = 'RESERVE',
  DEBIT = 'DEBIT',
  RELEASE = 'RELEASE',
  ADJUST = 'ADJUST',
}

/** What `reference_id` points at, if anything. */
export enum SmsCreditLedgerReferenceType {
  BATCH = 'batch',
  LOG = 'log',
  MANUAL = 'manual',
}

/**
 * Immutable append-only ledger of SMS credit movements, one row per unit
 * change. `sms_credit_balance` is the derived running total kept in sync
 * alongside every insert here — this table is the audit trail, never
 * updated or deleted after insert.
 *
 * Relations:
 * - @ManyToOne → School: the tenant this ledger row belongs to. Stored
 *   directly rather than derived from `reference_id` (which is a loose
 *   pointer into `batch`/`log`, not an FK) so every row is unambiguously
 *   scoped even when the reference has since been deleted.
 * - @ManyToOne → User (actor, optional): who triggered a manual
 *   GRANT/ADJUST; null for system-driven RESERVE/DEBIT/RELEASE.
 */
@Entity('sms_credit_ledger')
@Index(['tenant_id', 'created_at'])
@Unique('UQ_sms_credit_ledger_tenant_idempotency', ['tenant_id', 'idempotency_key'])
export class SmsCreditLedger {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'enum', enum: SmsCreditLedgerKind })
  kind: SmsCreditLedgerKind;

  // Signed for ADJUST (a manual correction can go either direction);
  // GRANT/DEBIT/RESERVE/RELEASE are always recorded as positive
  // magnitudes and their sign on the balance is implied by `kind`.
  @Column({ type: 'int' })
  units: number;

  @Column({ type: 'enum', enum: SmsCreditLedgerReferenceType })
  reference_type: SmsCreditLedgerReferenceType;

  @Column({ type: 'uuid', nullable: true })
  reference_id: string | null;

  @Column({ type: 'text' })
  idempotency_key: string;

  @Column({ type: 'text', nullable: true })
  reason: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'actor_user_id' })
  actor: User | null;

  @Column({ type: 'uuid', nullable: true })
  actor_user_id: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
