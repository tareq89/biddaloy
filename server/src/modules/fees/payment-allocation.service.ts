import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { Payment } from './entities/payment.entity';
import { PaymentAllocation } from './entities/payment-allocation.entity';
import { StudentFee } from './entities/student-fee.entity';
import { Student } from '../students/entities/student.entity';
import { Invoice } from '../invoices/entities/invoice.entity';
import { School } from '../schools/entities/school.entity';
import { AuditService } from '../audit/audit.service';
import {
  FeeStatus,
  InvoiceStatus,
  PaymentAllocationType,
  PaymentStatus,
  AuditAction,
} from '@biddaloy/shared';
import { RecordPaymentWithAllocationDto } from './dto/fees.dto';
import { generateInvoiceNumber } from '../invoices/invoice-numbering.util';
import {
  buildIssuerSnapshot,
  lockSchoolForSnapshot,
  resolveIssuer,
  IssuerSnapshot,
} from '../schools/profile/issuer-snapshot';

const AMOUNT_EPSILON = 0.01;

/**
 * Records a payment split across a student's fee periods (dues, current
 * month) and applies it to StudentFee/Invoice/AuditLog atomically.
 *
 * The caller submits the exact per-period breakdown (allocations), but the
 * server is the source of truth for whether that breakdown is valid: it
 * independently re-derives each fee's expected bucket (DUE/CURRENT) from
 * today's date and enforces that older outstanding fees are always settled
 * before newer ones — a client can never skip an overdue fee to pay a later
 * one. A future-dated fee can't be allocated against at all (D5 — the
 * ADVANCE path is removed; see wallet credit instead).
 *
 * [16.1.6] Also supports idempotent retries: pass `idempotency_key` and a
 * repeated call with the same key (per tenant) returns the payment already
 * recorded for it instead of creating a second one.
 */
@Injectable()
export class PaymentAllocationService {
  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
    @InjectRepository(Student)
    private readonly studentRepo: Repository<Student>,
    @InjectRepository(School)
    private readonly schoolRepo: Repository<School>,
    private readonly auditService: AuditService,
  ) {}

  async recordWithAllocation(
    dto: RecordPaymentWithAllocationDto,
    tenantId: string,
    userId: string,
  ): Promise<Payment & { issuer: IssuerSnapshot }> {
    // [16.1.6] Idempotency: a retried request (flaky network, a doubled
    // tap) carrying a key we've already recorded returns that payment
    // unchanged instead of charging twice. Checked up front to skip the
    // rest of the work on the common repeat-request path.
    if (dto.idempotency_key) {
      const existing = await this.findByIdempotencyKey(tenantId, dto.idempotency_key);
      if (existing) {
        this.assertIdempotentReplayMatches(existing, dto);
        return { ...existing, issuer: await this.resolveIssuerFor(existing, tenantId) };
      }
    }

    const student = await this.studentRepo.findOne({
      where: { id: dto.student_id, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!student) {
      throw new NotFoundException(`Student with ID "${dto.student_id}" not found`);
    }

    const allocationSum = dto.allocations.reduce((sum, a) => sum + Number(a.allocated_amount), 0);
    if (Math.abs(allocationSum - Number(dto.total_amount)) > AMOUNT_EPSILON) {
      throw new BadRequestException(
        `Allocation amounts (${allocationSum.toFixed(2)}) must sum to total_amount (${Number(dto.total_amount).toFixed(2)})`,
      );
    }

    const feeIds = dto.allocations.map((a) => a.student_fee_id);
    if (new Set(feeIds).size !== feeIds.length) {
      throw new BadRequestException('Duplicate student_fee_id in allocations');
    }

    const { paymentId, issuerSnapshot, duplicateKey } = await this.paymentRepo.manager.transaction(
      async (manager) => {
        // [15.5.5] Frozen at the moment of record, same reasoning as
        // InvoicesService.create — share-locked inside the transaction so a
        // profile edit that commits before this payment is what gets
        // snapshotted, never one that was already replaced.
        const school = await lockSchoolForSnapshot(manager, tenantId);
        const issuerSnapshot = buildIssuerSnapshot(school);

        const studentFeeRepo = manager.getRepository(StudentFee);
        const paymentRepo = manager.getRepository(Payment);
        const allocationRepo = manager.getRepository(PaymentAllocation);
        const invoiceRepo = manager.getRepository(Invoice);

        // Lock every outstanding fee for this student so two concurrent
        // payments can't both allocate against the same balance.
        const outstandingFees = await studentFeeRepo
          .createQueryBuilder('sf')
          .where('sf.student_id = :studentId', { studentId: dto.student_id })
          .andWhere('sf.status IN (:...statuses)', {
            statuses: [FeeStatus.PENDING, FeeStatus.PARTIALLY_PAID, FeeStatus.OVERDUE],
          })
          .orderBy('sf.year', 'ASC')
          .addOrderBy('sf.month', 'ASC')
          .setLock('pessimistic_write')
          .getMany();

        // [16.1.6] Re-check idempotency now that we hold the fee lock. Two
        // truly simultaneous requests with the same key both miss the
        // cheap pre-check above (neither has committed yet), then both try
        // to lock the same fee rows — the loser blocks here until the
        // winner commits. Once unblocked, the winner's payment (and its
        // idempotency_key) is visible, so check for it now, before
        // evaluating the fees against balances the winner already
        // consumed — which would otherwise throw a misleading
        // NotFoundException instead of returning the winner's payment.
        if (dto.idempotency_key) {
          const winner = await manager.getRepository(Payment).findOne({
            where: { tenant_id: tenantId, idempotency_key: dto.idempotency_key },
            relations: ['allocations', 'invoice'],
          });
          if (winner) {
            this.assertIdempotentReplayMatches(winner, dto);
            return { paymentId: winner.id, issuerSnapshot, duplicateKey: null };
          }
        }

        const outstandingById = new Map(outstandingFees.map((f) => [f.id, f]));
        for (const feeId of feeIds) {
          if (!outstandingById.has(feeId)) {
            throw new NotFoundException(
              `Student fee "${feeId}" not found, already paid, or does not belong to this student`,
            );
          }
        }
        const allocationsByFeeId = new Map(dto.allocations.map((a) => [a.student_fee_id, a]));

        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth() + 1;

        let blocked = false;
        const feeUpdates: {
          fee: StudentFee;
          newPaid: number;
          newStatus: FeeStatus;
          allocatedAmount: number;
        }[] = [];

        for (const fee of outstandingFees) {
          const remaining =
            Number(fee.total_amount) - Number(fee.paid_amount) - Number(fee.discount_amount);
          if (remaining <= AMOUNT_EPSILON) {
            if (allocationsByFeeId.has(fee.id)) {
              throw new BadRequestException(
                `Fee for ${fee.month}/${fee.year} has no outstanding balance and cannot be allocated against`,
              );
            }
            continue;
          }

          const alloc = allocationsByFeeId.get(fee.id);
          if (!alloc) {
            blocked = true;
            continue;
          }
          if (blocked) {
            throw new BadRequestException(
              `FIFO violation: fee for ${fee.month}/${fee.year} was allocated before an earlier outstanding fee was fully settled`,
            );
          }

          const expectedType = this.classifyPeriod(fee.year, fee.month, currentYear, currentMonth);
          if (alloc.allocation_type !== expectedType) {
            throw new BadRequestException(
              `Fee for ${fee.month}/${fee.year} must use allocation_type "${expectedType}", got "${alloc.allocation_type}"`,
            );
          }

          const allocAmount = Number(alloc.allocated_amount);
          if (allocAmount > remaining + AMOUNT_EPSILON) {
            throw new BadRequestException(
              `Allocated amount ${allocAmount} exceeds remaining balance ${remaining} for fee ${fee.month}/${fee.year}`,
            );
          }

          const newPaid = Number(fee.paid_amount) + allocAmount;
          const newStatus =
            newPaid + Number(fee.discount_amount) >= Number(fee.total_amount) - AMOUNT_EPSILON
              ? FeeStatus.PAID
              : FeeStatus.PARTIALLY_PAID;

          feeUpdates.push({ fee, newPaid, newStatus, allocatedAmount: allocAmount });

          if (allocAmount < remaining - AMOUNT_EPSILON) {
            // Ran out of money on this fee — nothing further may be allocated.
            blocked = true;
          }
        }

        const payment = paymentRepo.create({
          student_id: dto.student_id,
          total_amount: dto.total_amount,
          payment_method: dto.payment_method,
          payment_status: PaymentStatus.SUCCESS,
          transaction_reference: dto.transaction_reference ?? null,
          remarks: dto.remarks ?? null,
          received_by_user_id: userId,
          payment_date: now,
          tenant_id: tenantId,
          issuer_snapshot: issuerSnapshot,
          idempotency_key: dto.idempotency_key ?? null,
        });

        let savedPayment: Payment;
        try {
          savedPayment = await paymentRepo.save(payment);
        } catch (err) {
          // A concurrent request with the same key won the race and
          // committed first — the partial unique index on
          // (tenant_id, idempotency_key) rejects this insert. Nothing else
          // in this transaction has written yet (no fee/allocation rows),
          // so returning here (rather than throwing) is safe: Postgres has
          // already aborted this transaction because of the constraint
          // violation, so the COMMIT TypeORM issues next is a no-op — there
          // is nothing left for it to commit.
          if (dto.idempotency_key && isIdempotencyKeyViolation(err)) {
            return { paymentId: null, issuerSnapshot, duplicateKey: dto.idempotency_key };
          }
          throw err;
        }

        await allocationRepo.save(
          feeUpdates.map((u) =>
            allocationRepo.create({
              payment_id: savedPayment.id,
              student_fee_id: u.fee.id,
              allocated_amount: u.allocatedAmount,
              allocation_type: allocationsByFeeId.get(u.fee.id)!.allocation_type,
            }),
          ),
        );

        for (const { fee, newPaid, newStatus } of feeUpdates) {
          await studentFeeRepo.update(fee.id, { paid_amount: newPaid, status: newStatus });
        }

        await this.auditService.record(
          {
            action: AuditAction.PAYMENT_RECEIVED,
            entity_type: 'Payment',
            entity_id: savedPayment.id,
            tenant_id: tenantId,
            performed_by_user_id: userId,
            new_values: {
              student_id: dto.student_id,
              total_amount: dto.total_amount,
              payment_method: dto.payment_method,
              allocations: feeUpdates.map((u) => ({
                student_fee_id: u.fee.id,
                allocated_amount: u.allocatedAmount,
                allocation_type: allocationsByFeeId.get(u.fee.id)!.allocation_type,
              })),
            },
          },
          manager,
        );

        const isFullPayment =
          feeUpdates.length > 0 && feeUpdates.every((u) => u.newStatus === FeeStatus.PAID);
        if (isFullPayment && dto.generate_invoice !== false) {
          const invoiceNumber = await generateInvoiceNumber(invoiceRepo);
          const lineItems = feeUpdates.map((u) => ({
            description: `Fee for ${u.fee.month}/${u.fee.year}`,
            amount: u.allocatedAmount,
            quantity: 1,
            total: u.allocatedAmount,
          }));

          const invoice = await invoiceRepo.save(
            invoiceRepo.create({
              invoice_number: invoiceNumber,
              student_id: dto.student_id,
              student_fee_id: feeUpdates.length === 1 ? feeUpdates[0].fee.id : null,
              total_amount: dto.total_amount,
              tax_amount: 0,
              discount_amount: 0,
              status: InvoiceStatus.ISSUED,
              issued_date: now,
              due_date: now,
              line_items: lineItems,
              issued_by_user_id: userId,
              issuer_snapshot: issuerSnapshot,
            }),
          );
          await paymentRepo.update(savedPayment.id, { invoice_id: invoice.id });

          await this.auditService.record(
            {
              action: AuditAction.INVOICE_GENERATED,
              entity_type: 'Invoice',
              entity_id: invoice.id,
              tenant_id: tenantId,
              performed_by_user_id: userId,
              new_values: {
                invoice_number: invoiceNumber,
                payment_id: savedPayment.id,
                total_amount: dto.total_amount,
              },
            },
            manager,
          );
        }

        return { paymentId: savedPayment.id, issuerSnapshot, duplicateKey: null };
      },
    );

    if (duplicateKey) {
      const existing = await this.findByIdempotencyKey(tenantId, duplicateKey);
      if (existing) {
        return { ...existing, issuer: await this.resolveIssuerFor(existing, tenantId) };
      }
      // The insert hit the unique index (so a row with this key existed a
      // moment ago) but it's gone by the time we look again — something
      // else deleted it between the failed insert and this read. Surface
      // that plainly rather than falling through to `findOneOrFail` with a
      // null id, which would throw a confusing "payment not found".
      throw new BadRequestException(
        `idempotency_key "${duplicateKey}" conflicted with an existing payment that could not be re-read`,
      );
    }

    const payment = await this.paymentRepo.findOneOrFail({
      where: { id: paymentId! },
      relations: ['allocations', 'allocations.student_fee', 'invoice'],
    });
    // The payment just created always has its own fresh snapshot — no
    // fallback needed, but `resolveIssuer` is used anyway for one code
    // path rather than two ("just-created" vs "read later"). `issuerSnapshot`
    // (not a live `School` row) is what was actually frozen onto it, in
    // case a concurrent profile edit landed between commit and this read.
    return { ...payment, issuer: resolveIssuer(payment, issuerSnapshot) };
  }

  /** [16.1.6] The advance path is removed (D5) — a fee period in the
   * future can no longer be allocated against at all, so this throws
   * instead of returning `PaymentAllocationType.ADVANCE`. */
  private classifyPeriod(
    year: number,
    month: number,
    currentYear: number,
    currentMonth: number,
  ): PaymentAllocationType {
    if (year < currentYear || (year === currentYear && month < currentMonth)) {
      return PaymentAllocationType.DUE;
    }
    if (year === currentYear && month === currentMonth) {
      return PaymentAllocationType.CURRENT;
    }
    throw new BadRequestException(
      `Fee for ${month}/${year} is in the future and cannot be allocated against — advance payments are no longer supported`,
    );
  }

  /**
   * A genuine retry replays the exact same request. A key reused with a
   * materially different request — different student, amount, method,
   * allocations, invoice flag, reference, or remarks — is a client bug,
   * not a network retry: surface it instead of silently handing back an
   * unrelated payment. `allocations` is compared by (student_fee_id,
   * allocated_amount, allocation_type) as an order-independent set, since
   * two equivalent requests may list the same allocations in a different
   * order.
   */
  private assertIdempotentReplayMatches(
    existing: Payment,
    dto: RecordPaymentWithAllocationDto,
  ): void {
    const mismatch =
      existing.student_id !== dto.student_id ||
      Math.abs(Number(existing.total_amount) - Number(dto.total_amount)) > AMOUNT_EPSILON ||
      existing.payment_method !== dto.payment_method ||
      (existing.transaction_reference ?? null) !== (dto.transaction_reference ?? null) ||
      (existing.remarks ?? null) !== (dto.remarks ?? null) ||
      !this.allocationsMatch(existing.allocations ?? [], dto.allocations);
    // `generate_invoice` is deliberately not compared here: it isn't
    // persisted anywhere on `Payment`, and `Boolean(existing.invoice)`
    // is NOT a proxy for it — an invoice is only ever created when the
    // payment is also a *full* payment (`isFullPayment && generate_invoice
    // !== false`, see below), so a replay of a genuinely identical
    // request against the same already-recorded payment would compare a
    // fixed, already-decided outcome against a flag that can no longer
    // change anything. There's nothing unsafe left to catch here: the
    // fields above (student, amount, method, allocations, reference,
    // remarks) are exactly what determines the money movement.

    if (mismatch) {
      throw new BadRequestException(
        `idempotency_key "${dto.idempotency_key}" was already used for a different payment request`,
      );
    }
  }

  private allocationsMatch(
    existing: PaymentAllocation[],
    incoming: RecordPaymentWithAllocationDto['allocations'],
  ): boolean {
    if (existing.length !== incoming.length) return false;

    const normalize = (a: {
      student_fee_id: string;
      allocated_amount: number;
      allocation_type: PaymentAllocationType;
    }) => `${a.student_fee_id}:${Number(a.allocated_amount).toFixed(2)}:${a.allocation_type}`;

    const existingKeys = existing.map((a) => normalize(a)).sort();
    const incomingKeys = incoming.map((a) => normalize(a)).sort();

    return existingKeys.every((k, i) => k === incomingKeys[i]);
  }

  private async findByIdempotencyKey(tenantId: string, key: string): Promise<Payment | null> {
    return this.paymentRepo.findOne({
      where: { tenant_id: tenantId, idempotency_key: key },
      relations: ['allocations', 'allocations.student_fee', 'invoice'],
    });
  }

  /** An idempotent-replay payment always already has its own frozen
   * `issuer_snapshot` — this service never creates one without it — but
   * `resolveIssuer`'s live-school fallback is still wired up for the one
   * theoretical case (a snapshot capture that somehow failed) rather than
   * asserting it away. */
  private async resolveIssuerFor(payment: Payment, tenantId: string): Promise<IssuerSnapshot> {
    if (payment.issuer_snapshot) {
      return payment.issuer_snapshot;
    }
    const school = await this.schoolRepo.findOneByOrFail({ id: tenantId });
    return resolveIssuer(payment, school);
  }
}

/** True when `err` is specifically a unique-violation (SQLSTATE 23505) on
 * the `(tenant_id, idempotency_key)` partial index — not just any
 * unique-constraint failure on `payments`, so a future unrelated unique
 * constraint on this table can't be misread as an idempotency race. Works
 * however the error reached us — a raw driver error or TypeORM's
 * `QueryFailedError` wrapper, both of which surface the driver's `code`
 * and `constraint`. */
function isIdempotencyKeyViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { code?: unknown; constraint?: unknown };
  return e.code === '23505' && e.constraint === 'IDX_payments_tenant_idempotency_key';
}
