import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Check,
} from 'typeorm';
import {
  PaymentGatewayEnvironment,
  PaymentGatewayProvider,
  PaymentMethod,
  PaymentProofRejectReason,
  PaymentSubmissionSource,
  PaymentSubmissionStatus,
} from '@biddaloy/shared';
import { School } from '../../schools/entities/school.entity';
import { User } from '../../users/entities/user.entity';

/**
 * [3.x] One guardian payment attempt: a manual proof (PROOF, reviewed by staff) or an online
 * gateway attempt (ONLINE). The per-row CHECKs live in migration 1792300000000-PaymentSubmissions;
 * the TrxID partial unique is declared below. Cross-row rules (one waiting proof per bill, 5
 * waiting per guardian, proof amount equals the bills' total) belong to the submit service.
 * Money is `decimal(10,2)` like `payments.total_amount`; Postgres returns it as a string,
 * compare with `toPaisa`.
 */
@Entity('payment_submissions')
@Check('CHK_payment_submissions_amount', '"amount" > 0 AND "amount" <= 99999999.99')
@Check(
  'CHK_payment_submissions_proof',
  `"source" <> 'PROOF' OR ("method" IS NOT NULL AND "paid_on" IS NOT NULL AND "provider" IS NULL)`,
)
@Check(
  'CHK_payment_submissions_online',
  `"source" <> 'ONLINE' OR ("provider" IS NOT NULL AND "method" IS NULL)`,
)
@Check(
  'CHK_payment_submissions_reject_note',
  `"reject_reason" IS DISTINCT FROM 'OTHER' OR "reject_note" IS NOT NULL`,
)
@Index(['tenant_id'])
@Index(['tenant_id', 'status', 'source'])
@Index(['tenant_id', 'provider', 'provider_trx_id'], {
  unique: true,
  where: '"provider_trx_id" IS NOT NULL',
})
export class PaymentSubmission {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'enum', enum: PaymentSubmissionSource })
  source: PaymentSubmissionSource;

  @Column({ type: 'enum', enum: PaymentSubmissionStatus, default: PaymentSubmissionStatus.PENDING })
  status: PaymentSubmissionStatus;

  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({ name: 'submitted_by_user_id' })
  submitted_by: User;

  @Column({ type: 'uuid' })
  submitted_by_user_id: string;

  /** PROOF only. */
  @Column({ type: 'enum', enum: PaymentMethod, nullable: true })
  method: PaymentMethod | null;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  amount: number;

  /** PROOF only. */
  @Column({ type: 'date', nullable: true })
  paid_on: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  reference_raw: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  reference_normalised: string | null;

  /** ONLINE only. */
  @Column({ type: 'enum', enum: PaymentGatewayProvider, nullable: true })
  provider: PaymentGatewayProvider | null;

  @Column({ type: 'enum', enum: PaymentGatewayEnvironment, nullable: true })
  environment: PaymentGatewayEnvironment | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  provider_payment_id: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  provider_trx_id: string | null;

  @Column({ type: 'enum', enum: PaymentProofRejectReason, nullable: true })
  reject_reason: PaymentProofRejectReason | null;

  @Column({ type: 'text', nullable: true })
  reject_note: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'decided_by_user_id' })
  decided_by: User | null;

  @Column({ type: 'uuid', nullable: true })
  decided_by_user_id: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  decided_at: Date | null;

  @Column({ type: 'text', nullable: true })
  discard_reason: string | null;

  /** D12: paid at the gateway but no bill could take it. */
  @Column({ type: 'boolean', default: false })
  unmatched: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  started_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  settled_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  expires_at: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
