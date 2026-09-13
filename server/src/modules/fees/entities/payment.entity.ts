import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  ManyToOne,
  JoinColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { Student } from '../../students/entities/student.entity';
import { User } from '../../users/entities/user.entity';
import { School } from '../../schools/entities/school.entity';
import { Invoice } from '../../invoices/entities/invoice.entity';
import { PaymentMethod, PaymentStatus } from '@biddaloy/shared';
import { PaymentAllocation } from './payment-allocation.entity';
import { IssuerSnapshot } from '../../schools/profile/issuer-snapshot';

/**
 * Records a financial transaction — fee payment collected from a student.
 *
 * A single payment can be split across multiple months/periods via
 * PaymentAllocation records (e.g., paying last month's due + current month
 * + advance). Supports manual recording (cash/cheque received by staff)
 * and future online payments. Each payment can optionally generate an invoice.
 *
 * Relations:
 * - @ManyToOne → Student: the student this payment is for
 * - @ManyToOne → School: the tenant this payment belongs to
 * - @ManyToOne → User (received_by): the staff member who collected the payment
 * - @ManyToOne → Invoice (optional): the generated invoice
 * - @OneToMany → PaymentAllocation: how this payment is split across fee periods
 */
@Entity('payments')
@Index(['student_id'])
@Index(['invoice_id'])
@Index(['created_at'])
@Index(['tenant_id'])
@Index(['tenant_id', 'payment_date'])
@Index(['received_by_user_id'])
@Index(['tenant_id', 'idempotency_key'], {
  unique: true,
  where: '"idempotency_key" IS NOT NULL',
})
export class Payment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Student, { nullable: false })
  @JoinColumn({ name: 'student_id' })
  student: Student;

  @Column({ type: 'uuid' })
  student_id: string;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  total_amount: number;

  @Column({ type: 'enum', enum: PaymentMethod })
  payment_method: PaymentMethod;

  @Column({ type: 'enum', enum: PaymentStatus, default: PaymentStatus.SUCCESS })
  payment_status: PaymentStatus;

  @Column({ type: 'varchar', length: 100, nullable: true })
  transaction_reference: string | null;

  @Column({ type: 'text', nullable: true })
  remarks: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'received_by_user_id' })
  received_by: User | null;

  @Column({ type: 'uuid', nullable: true })
  received_by_user_id: string | null;

  @ManyToOne(() => Invoice, { nullable: true })
  @JoinColumn({ name: 'invoice_id' })
  invoice: Invoice | null;

  @Column({ type: 'uuid', nullable: true })
  invoice_id: string | null;

  @OneToMany(() => PaymentAllocation, (alloc) => alloc.payment, { cascade: ['insert', 'update'] })
  allocations: PaymentAllocation[];

  @Column({ type: 'timestamptz' })
  payment_date: Date;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  /** [16.1.6] Client-supplied key so a retried checkout request (a flaky
   * network, a doubled tap) never records the payment twice. Unique per
   * `(tenant_id, idempotency_key)` — enforced by a partial index that
   * ignores NULL, since most payments recorded before the 16.4.2 checkout
   * endpoint lands never set one. `PaymentAllocationService` returns the
   * existing payment unchanged when this key is reused. Never exposed to
   * families (`FamilyPaymentDto` is an allow-list that omits it). */
  @Column({ type: 'varchar', length: 64, nullable: true })
  idempotency_key: string | null;

  /** [16.1.6] Cash actually handed over at checkout, when it exceeds
   * `total_amount` (change is due back). NULL for non-cash methods and for
   * payments recorded before checkout tracked this. */
  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  tendered_amount: number | null;

  /** [16.1.6] `tendered_amount - total_amount` handed back to the payer. */
  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  change_amount: number;

  /** [16.1.6] How much of this payment's `total_amount` was covered by the
   * student's wallet credit balance (replaces the removed ADVANCE path —
   * see D5). */
  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  wallet_credit_used: number;

  /** [16.1.6] How much wallet credit this payment added (e.g. change the
   * payer chose to keep on account instead of taking as cash). */
  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  wallet_credit_added: number;

  /** [16.1.6] Set on the reversal payment, pointing back at the payment it
   * reverses. Self-referencing FK; populated by the reversal flow (later
   * ticket), not by `recordWithAllocation`. */
  @ManyToOne(() => Payment, { nullable: true })
  @JoinColumn({ name: 'reversal_of_payment_id' })
  reversal_of_payment: Payment | null;

  @Column({ type: 'uuid', nullable: true })
  reversal_of_payment_id: string | null;

  /** [16.1.6] Set on the original payment once it has been reversed,
   * pointing at the reversal payment. */
  @ManyToOne(() => Payment, { nullable: true })
  @JoinColumn({ name: 'reversed_by_payment_id' })
  reversed_by_payment: Payment | null;

  @Column({ type: 'uuid', nullable: true })
  reversed_by_payment_id: string | null;

  /** [16.1.6] Why this payment was reversed. Staff-facing only — never
   * exposed to families. */
  @Column({ type: 'varchar', length: 500, nullable: true })
  reversal_reason: string | null;

  /** [16.1.6] Staff member who approved the reversal, when approval is
   * required. Distinct from `received_by_user_id` (who took the original
   * money). */
  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'approved_by_user_id' })
  approved_by: User | null;

  @Column({ type: 'uuid', nullable: true })
  approved_by_user_id: string | null;

  /** [15.5.5] School identity frozen at record time. Null for payments
   * recorded before this column existed, or on rare failure to build a
   * snapshot — reads fall back to the live school profile in that case. */
  // `@ApiProperty({ type: () => IssuerSnapshot })` is required here — the
  // `@nestjs/swagger` CLI plugin auto-infers every other column's OpenAPI
  // type from its TS annotation with no decorator, but it cannot resolve a
  // class imported from another module used only as a plain property type;
  // without this it silently produced an empty `{}` schema.
  @ApiProperty({ type: () => IssuerSnapshot, nullable: true })
  @Column({ type: 'jsonb', nullable: true })
  issuer_snapshot: IssuerSnapshot | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;
}
