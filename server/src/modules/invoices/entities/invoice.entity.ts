import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { Student } from '../../students/entities/student.entity';
import { Payment } from '../../fees/entities/payment.entity';
import { User } from '../../users/entities/user.entity';
import { InvoiceStatus, InvoiceKind, PaymentMethod } from '@biddaloy/shared';
import { IssuerSnapshot } from '../../schools/profile/issuer-snapshot';

/** [16.5.1] One line item on one student's bill, as it stood the moment
 * the invoice was issued. */
export interface InvoiceSnapshotLine {
  fee_name: string;
  period_label: string;
  amount: number;
  discount: number;
  paid_this_time: number;
  balance_after: number;
}

/** [16.5.1] One student's slice of a (possibly multi-student, e.g.
 * siblings paid in one checkout) invoice. */
export interface InvoiceSnapshotStudent {
  id: string;
  full_name: string;
  registration_number: string;
  class_name: string | null;
  lines: InvoiceSnapshotLine[];
}

export interface InvoiceSnapshotTotals {
  billed: number;
  discount: number;
  paid: number;
  change: number;
  wallet_used: number;
  wallet_added: number;
}

export interface InvoiceSnapshotPayment {
  method: PaymentMethod;
  reference: string | null;
  received_by_name: string | null;
  payment_date: string;
}

/** [16.5.1] The entire immutable document frozen onto an `Invoice` at
 * issue time. Everything a printed/PDF invoice needs to render lives
 * here — school identity, every paying student's lines, totals, and how
 * the money was received — so later edits to the underlying fee/payment
 * rows (or even the student's name) never change what an already-issued
 * invoice shows. */
export interface InvoiceSnapshot {
  issuer: IssuerSnapshot;
  students: InvoiceSnapshotStudent[];
  totals: InvoiceSnapshotTotals;
  payment: InvoiceSnapshotPayment;
}

/**
 * Official immutable financial document — an invoice issued at checkout,
 * or a credit note reversing one.
 *
 * [16.5.1] Rebuilt as a frozen snapshot: once `status` leaves `DRAFT`, a
 * DB trigger (see `1789800008000-InvoiceImmutableSnapshot` migration)
 * only allows `status`, `updated_at`, `deleted_at` to change on that row
 * — everything a printed invoice shows lives in `snapshot`, captured once
 * at `create()`/`createCreditNote()` time. `create()` always issues with
 * `status = ISSUED` immediately; there is no DRAFT checkout invoice.
 *
 * Uses sequential numbering (`INV-YYYY-NNNNN` for invoices,
 * `CN-YYYY-NNNNNN` for credit notes — see `invoice-numbering.util.ts`).
 *
 * Relations:
 * - @ManyToOne → Student: first/primary student on the invoice (a
 *   multi-student checkout snapshots every student under `snapshot`, but
 *   this column stays singular for existing per-student queries).
 * - @ManyToOne → Payment: the payment this document was generated from.
 * - @ManyToOne → Invoice (`related_invoice_id`): for a credit note, the
 *   invoice it reverses.
 * - @ManyToOne → User (issued_by): who generated the document.
 */
@Entity('invoices')
export class Invoice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 50, unique: true })
  invoice_number: string;

  @Column({ type: 'enum', enum: InvoiceKind, default: InvoiceKind.INVOICE })
  kind: InvoiceKind;

  @ManyToOne(() => Student, { nullable: false })
  @JoinColumn({ name: 'student_id' })
  student: Student;

  @Column({ type: 'uuid' })
  student_id: string;

  @ManyToOne(() => Payment, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'payment_id' })
  payment: Payment | null;

  @Column({ type: 'uuid', nullable: true })
  payment_id: string | null;

  /** [16.5.1] For a credit note (`kind = CREDIT_NOTE`), the invoice it
   * reverses. Null for an ordinary invoice. */
  @ManyToOne(() => Invoice, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'related_invoice_id' })
  related_invoice: Invoice | null;

  @Column({ type: 'uuid', nullable: true })
  related_invoice_id: string | null;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  total_amount: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  tax_amount: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  discount_amount: number;

  @Column({ type: 'enum', enum: InvoiceStatus, default: InvoiceStatus.DRAFT })
  status: InvoiceStatus;

  @Column({ type: 'date' })
  issued_date: Date;

  @Column({ type: 'date' })
  due_date: Date;

  /** [16.5.1] The whole frozen document — see `InvoiceSnapshot`. Replaces
   * the old flat `line_items` column; every student/line/total this
   * invoice shows lives here instead. */
  @ApiProperty({ type: 'object', additionalProperties: true })
  @Column({ type: 'jsonb' })
  snapshot: InvoiceSnapshot;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'issued_by_user_id' })
  issued_by: User | null;

  @Column({ type: 'uuid', nullable: true })
  issued_by_user_id: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  /** [15.5.5] School identity frozen at issue time. Null for invoices
   * created before this column existed, or on rare failure to build a
   * snapshot — reads fall back to the live school profile in that case.
   * [16.5.1] Also duplicated onto `snapshot.issuer`, which is what the
   * print template now reads; this column is kept for `resolveIssuer`'s
   * existing read-side fallback path. */
  // See identical comment on `Payment.issuer_snapshot` for why the
  // decorator is required.
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
