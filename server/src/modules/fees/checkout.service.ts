import { EventEmitter } from 'events';
import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  AuditAction,
  ApprovalScope,
  FeeStatus,
  PaymentAllocationType,
  PaymentStatus,
  WalletTransactionKind,
} from '@biddaloy/shared';
import { Payment } from './entities/payment.entity';
import { PaymentAllocation } from './entities/payment-allocation.entity';
import { StudentFee } from './entities/student-fee.entity';
import { Student } from '../students/entities/student.entity';
import { WalletService } from './wallet.service';
import { applyAllocationToBill } from './payment-allocation.service';
import { ApprovalService } from '../auth/guards/approval.guard';
import { AuditService } from '../audit/audit.service';
import { InvoicesService } from '../invoices/invoices.service';
import { CheckoutDto, CheckoutResultDto } from './dto/checkout.dto';
import { buildIssuerSnapshot, lockSchoolForSnapshot } from '../schools/profile/issuer-snapshot';

const AMOUNT_EPSILON = 0.01;

/** [D14] Same reasoning as `checkout-cart.service.ts`'s own copy — every
 * "is this bill overdue" check goes through the tenant's calendar day in
 * Asia/Dhaka, never server-local time. Duplicated rather than imported:
 * `checkout-cart.service.ts` doesn't export it, and this ticket's
 * territory doesn't include changing that file just to share one helper. */
const SCHOOL_TIMEZONE = 'Asia/Dhaka';

function todayInSchoolTimezone(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: SCHOOL_TIMEZONE }).format(new Date());
}

function dateKey(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * [16.4.2] Emitted after a checkout transaction commits. This is a
 * PLACEHOLDER for real cross-cutting event infra: this codebase has no
 * event-emitter mechanism anywhere (`@nestjs/event-emitter` isn't a
 * dependency, no `EventEmitter2` usage exists), and wiring one up properly
 * means registering it in `server/src/app.module.ts` — outside this
 * ticket's file territory. A plain Node `EventEmitter` scoped to this
 * module is the smallest thing that satisfies step 4 ("emit
 * `payments.recorded`") without touching `app.module.ts`. 16.5.4's
 * consumer (not built yet) can `checkoutEvents.on('payments.recorded', …)`
 * against this same instance until a real event bus replaces it.
 */
export const checkoutEvents = new EventEmitter();

export interface PaymentsRecordedEvent {
  payment_id: string;
  tenant_id: string;
  student_ids: string[];
}

/** True when `err` is specifically a unique-violation on the
 * `(tenant_id, idempotency_key)` partial index on `payments` — see
 * `payment-allocation.service.ts`'s identical check. Duplicated rather
 * than imported since that file doesn't export it. */
function isIdempotencyKeyViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { code?: unknown; constraint?: unknown };
  return e.code === '23505' && e.constraint === 'IDX_payments_tenant_idempotency_key';
}

interface RequestLike {
  headers: Record<string, string | string[] | undefined>;
  currentTenant?: { id: string };
  user?: { sub: string };
}

/** Set by `checkout()` so the controller can answer an idempotent replay
 * with `200 OK` instead of `201 Created` while still using a plain return
 * value (no `@Res()` needed on the happy path). */
export interface CheckoutMeta {
  replayed: boolean;
}

/**
 * `POST /payments/checkout` (16.4.2) — the write side of the Record
 * Payment modal built in 16.4.1: records one payment across one or more
 * students' bills in a single locked, idempotent transaction, applying
 * wallet credit, one-off discounts (behind step-up approval), and cash
 * tendered/change.
 *
 * Unlike `PaymentAllocationService.recordWithAllocation` (single student,
 * FIFO-only), a checkout line names its own bill and amount directly — the
 * cart (16.4.1) is what suggests those amounts, this endpoint just applies
 * whatever the caller confirms.
 */
@Injectable()
export class CheckoutService {
  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
    @InjectRepository(Student)
    private readonly studentRepo: Repository<Student>,
    private readonly walletService: WalletService,
    private readonly approvalService: ApprovalService,
    private readonly auditService: AuditService,
    private readonly invoicesService: InvoicesService,
  ) {}

  async checkout(
    dto: CheckoutDto,
    tenantId: string,
    userId: string,
    request: RequestLike,
    meta?: CheckoutMeta,
  ): Promise<CheckoutResultDto> {
    const existing = await this.findByIdempotencyKey(tenantId, dto.idempotency_key);
    if (existing) {
      this.assertIdempotentReplayMatches(existing, dto);
      if (meta) meta.replayed = true;
      const repaired = await this.ensureInvoiceLinked(existing.id);
      return this.toResult(repaired, tenantId);
    }

    const lineFeeIds = dto.lines.map((l) => l.student_fee_id);
    if (new Set(lineFeeIds).size !== lineFeeIds.length) {
      throw new BadRequestException('Duplicate student_fee_id in lines');
    }

    const { paymentId, duplicateKey, winnerId } = await this.paymentRepo.manager.transaction(
      async (manager) => {
        const studentFeeRepo = manager.getRepository(StudentFee);
        const paymentRepo = manager.getRepository(Payment);
        const allocationRepo = manager.getRepository(PaymentAllocation);

        // Lock every bill this checkout touches — mirrors
        // `PaymentAllocationService`'s `.setLock('pessimistic_write')`
        // pattern so two concurrent checkouts against the same bill
        // serialize instead of both reading the same starting balance.
        // Deterministic `ORDER BY` so two overlapping checkouts always
        // acquire row locks in the same order, avoiding a Postgres 40P01
        // deadlock. No join here: Postgres refuses `FOR UPDATE` on the
        // nullable side of a LEFT JOIN, so `student`/`fee_structure` are
        // hydrated in a second, unlocked read below instead.
        const lockedBills = await studentFeeRepo
          .createQueryBuilder('sf')
          .where('sf.id IN (:...ids)', { ids: lineFeeIds })
          .andWhere('sf.deleted_at IS NULL')
          .andWhere('sf.status IN (:...statuses)', {
            statuses: [FeeStatus.PENDING, FeeStatus.PARTIALLY_PAID, FeeStatus.OVERDUE],
          })
          .orderBy('sf.id', 'ASC')
          .setLock('pessimistic_write')
          .getMany();

        const bills = await studentFeeRepo.find({
          where: { id: In(lockedBills.map((b) => b.id)) },
          relations: ['student', 'fee_structure'],
        });

        // Re-check idempotency now that the bill locks are held — a truly
        // simultaneous duplicate request blocks here until the winner
        // commits, same reasoning as `recordWithAllocation`.
        const winner = await manager.getRepository(Payment).findOne({
          where: { tenant_id: tenantId, idempotency_key: dto.idempotency_key },
          relations: ['allocations', 'invoice'],
        });
        if (winner) {
          this.assertIdempotentReplayMatches(winner, dto);
          // Short-circuit here — do NOT fall through to invoice creation.
          // The winner's own request already created (or will create) its
          // invoice; minting a second one here would double-invoice the
          // same payment and re-emit `payments.recorded`.
          return { paymentId: null, duplicateKey: null, winnerId: winner.id };
        }

        const billsById = new Map(bills.map((b) => [b.id, b]));
        for (const line of dto.lines) {
          const bill = billsById.get(line.student_fee_id);
          if (!bill) {
            throw new NotFoundException(
              `Student fee "${line.student_fee_id}" not found or already deleted`,
            );
          }
          // `bill.student` can be null when the student relation was
          // soft-deleted — TypeORM's relation join auto-filters
          // `deleted_at IS NULL`, so the FK still resolves but the object
          // doesn't. Guard before dereferencing rather than letting a
          // TypeError bubble up as an unhandled 500.
          if (!bill.student) {
            throw new NotFoundException(
              `Student fee "${line.student_fee_id}" not found for this tenant`,
            );
          }
          if (bill.student.tenant_id !== tenantId || bill.student.deleted_at) {
            throw new NotFoundException(
              `Student fee "${line.student_fee_id}" not found for this tenant`,
            );
          }
          const balance = round2(
            Number(bill.total_amount) - Number(bill.discount_amount) - Number(bill.paid_amount),
          );
          const requested = round2(Number(line.amount) + Number(line.one_off_discount ?? 0));
          if (requested > balance + AMOUNT_EPSILON) {
            throw new BadRequestException(
              `amount + one_off_discount (${requested}) exceeds the outstanding balance (${balance}) for student fee "${bill.id}"`,
            );
          }
        }

        const primaryStudentId = billsById.get(dto.lines[0].student_fee_id)!.student_id;
        const totalAmount = round2(dto.lines.reduce((sum, l) => sum + Number(l.amount), 0));
        const walletUse = round2(dto.wallet_use ?? 0);
        const changeHandling = dto.change_handling ?? 'RETURN';

        if (walletUse > 0) {
          // Wallets are strictly per-student (see
          // `checkout-cart.service.ts`'s documented invariant around line
          // 234): `wallet_use` only ever debits the primary line's
          // student, so refuse it outright when the lines span more than
          // one student rather than silently applying one student's money
          // to another's bill. Multi-student wallet allocation is out of
          // scope for this ticket.
          const distinctStudentIds = new Set(
            dto.lines.map((l) => billsById.get(l.student_fee_id)!.student_id),
          );
          if (distinctStudentIds.size > 1) {
            throw new BadRequestException(
              'wallet_use cannot be combined with a checkout that spans more than one student',
            );
          }

          if (walletUse > totalAmount + AMOUNT_EPSILON) {
            throw new BadRequestException('wallet_use cannot exceed the sum of the checkout lines');
          }

          const balance = await this.walletService.balance(primaryStudentId, tenantId);
          if (walletUse > balance + AMOUNT_EPSILON) {
            throw new BadRequestException('wallet_use exceeds the student wallet balance');
          }
        }

        const tenderedAmount = dto.tendered_amount ?? round2(Math.max(0, totalAmount - walletUse));
        const change = round2(walletUse + tenderedAmount - totalAmount);
        if (change < -AMOUNT_EPSILON) {
          throw new BadRequestException(
            'wallet_use + tendered_amount must cover the sum of the checkout lines',
          );
        }

        // Every validation that can still fail the request has run by this
        // point. `approvalService.consume()` is an irreversible Redis
        // GETDEL — burn the token last, as the final gate before writes,
        // so a request that fails validation never wastes a legitimately
        // granted approval.
        const hasDiscount = dto.lines.some((l) => (l.one_off_discount ?? 0) > 0);
        let approvedByUserId: string | null = null;
        if (hasDiscount) {
          const approval = await this.approvalService.consume(request, ApprovalScope.FEES_DISCOUNT);
          approvedByUserId = approval.approverId;
        }

        const now = dto.payment_date ? new Date(dto.payment_date) : new Date();
        const today = todayInSchoolTimezone();

        // [15.5.5] Frozen at the moment of record — same reasoning as
        // `PaymentAllocationService.recordWithAllocation` and
        // `InvoicesService.create`: share-locked inside this transaction
        // so a profile edit that commits before this payment is what gets
        // snapshotted.
        const school = await lockSchoolForSnapshot(manager, tenantId);
        const issuerSnapshot = buildIssuerSnapshot(school);

        const payment = paymentRepo.create({
          student_id: primaryStudentId,
          total_amount: totalAmount,
          payment_method: dto.payment_method,
          payment_status: PaymentStatus.SUCCESS,
          transaction_reference: dto.transaction_reference ?? null,
          remarks: dto.remarks ?? null,
          received_by_user_id: userId,
          payment_date: now,
          tenant_id: tenantId,
          idempotency_key: dto.idempotency_key,
          tendered_amount: dto.tendered_amount ?? null,
          change_amount: changeHandling === 'RETURN' ? change : 0,
          wallet_credit_used: walletUse,
          wallet_credit_added: changeHandling === 'TO_WALLET' ? change : 0,
          approved_by_user_id: approvedByUserId,
          issuer_snapshot: issuerSnapshot,
        });

        let savedPayment: Payment;
        try {
          savedPayment = await paymentRepo.save(payment);
        } catch (err) {
          if (isIdempotencyKeyViolation(err)) {
            return { paymentId: null, duplicateKey: dto.idempotency_key, winnerId: null };
          }
          throw err;
        }

        const billStateBefore = new Map(
          bills.map((b) => [
            b.id,
            {
              paid_amount: Number(b.paid_amount),
              discount_amount: Number(b.discount_amount),
              status: b.status,
            },
          ]),
        );

        const allocationRows: {
          student_fee_id: string;
          allocated_amount: number;
          allocation_type: PaymentAllocationType;
          discount_amount: number;
        }[] = [];

        for (const line of dto.lines) {
          const bill = billsById.get(line.student_fee_id)!;
          const update = applyAllocationToBill(
            bill,
            Number(line.amount),
            Number(line.one_off_discount ?? 0),
          );
          await studentFeeRepo.update(bill.id, update);

          const dueKey = dateKey(bill.due_date);
          const allocationType =
            dueKey !== null && dueKey < today
              ? PaymentAllocationType.DUE
              : PaymentAllocationType.CURRENT;
          allocationRows.push({
            student_fee_id: bill.id,
            allocated_amount: Number(line.amount),
            allocation_type: allocationType,
            discount_amount: Number(line.one_off_discount ?? 0),
          });
        }

        await allocationRepo.save(
          allocationRows.map((row) =>
            allocationRepo.create({ ...row, payment_id: savedPayment.id }),
          ),
        );

        if (walletUse > 0) {
          await this.walletService.debit(
            {
              studentId: primaryStudentId,
              tenantId,
              amount: walletUse,
              kind: WalletTransactionKind.DEBIT_CHECKOUT,
              paymentId: savedPayment.id,
              createdByUserId: userId,
            },
            manager,
          );
        }
        if (changeHandling === 'TO_WALLET' && change > AMOUNT_EPSILON) {
          await this.walletService.credit(
            {
              studentId: primaryStudentId,
              tenantId,
              amount: change,
              kind: WalletTransactionKind.CREDIT_CHANGE,
              paymentId: savedPayment.id,
              createdByUserId: userId,
            },
            manager,
          );
        }

        const auditPayload = {
          action: AuditAction.PAYMENT_RECEIVED,
          entity_type: 'Payment' as const,
          entity_id: savedPayment.id,
          tenant_id: tenantId,
          performed_by_user_id: userId,
          old_values: {
            bills: bills.map((b) => ({ student_fee_id: b.id, ...billStateBefore.get(b.id) })),
          },
          new_values: {
            student_ids: [...new Set(bills.map((b) => b.student_id))],
            total_amount: totalAmount,
            payment_method: dto.payment_method,
            lines: allocationRows,
            wallet_use: walletUse,
            change_amount: change,
            change_handling: changeHandling,
          },
        };
        if (approvedByUserId) {
          await this.auditService.recordApproved(
            {
              ...auditPayload,
              approved_by_user_id: approvedByUserId,
              approval_scope: ApprovalScope.FEES_DISCOUNT,
            },
            manager,
          );
        } else {
          await this.auditService.record(auditPayload, manager);
        }

        return { paymentId: savedPayment.id, duplicateKey: null, winnerId: null };
      },
    );

    if (winnerId) {
      // Another concurrent request with the same idempotency key won the
      // race inside the transaction above — return its already-recorded
      // result. Falling through to invoice creation below would mint a
      // second invoice for the same payment.
      if (meta) meta.replayed = true;
      const repaired = await this.ensureInvoiceLinked(winnerId);
      return this.toResult(repaired, tenantId);
    }

    let finalPaymentId = paymentId;
    if (duplicateKey) {
      if (meta) meta.replayed = true;
      const winner = await this.findByIdempotencyKey(tenantId, duplicateKey);
      if (!winner) {
        throw new BadRequestException(
          `idempotency_key "${duplicateKey}" conflicted with an existing payment that could not be re-read`,
        );
      }
      const repaired = await this.ensureInvoiceLinked(winner.id);
      return this.toResult(repaired, tenantId);
    }

    // Invoice creation is deliberately outside the transaction above:
    // `InvoicesService.create` opens its own transaction (it needs a
    // fresh, uncontended lock on `schools` for the issuer snapshot), so
    // nesting it inside the checkout transaction would either deadlock on
    // the same connection or silently run on a second, uncoordinated one.
    // The payment itself is already durably committed by this point; a
    // failure here leaves a valid payment without an invoice rather than
    // rolling back money already recorded, which is the safer failure mode
    // for a cashier who has already handed over a receipt confirmation.
    // `ensureInvoiceLinked` is what makes that recoverable: every replay
    // of this idempotency key (including one that hits this exact code
    // path again, since `finalPaymentId` is already committed) retries
    // the missing invoice rather than returning an incomplete result
    // forever — see its own doc comment.
    const payment = await this.ensureInvoiceLinked(finalPaymentId!);

    const walletBalanceAfter = await this.walletService.balance(payment.student_id, tenantId);

    checkoutEvents.emit('payments.recorded', {
      payment_id: payment.id,
      tenant_id: tenantId,
      student_ids: [...new Set(payment.allocations.map((a) => a.student_fee.student_id))],
    } satisfies PaymentsRecordedEvent);

    return {
      payment,
      invoice_id: payment.invoice_id ?? '',
      invoice_number: payment.invoice?.invoice_number ?? '',
      change_amount: Number(payment.change_amount),
      wallet_balance_after: walletBalanceAfter,
    };
  }

  /**
   * A genuine retry replays the exact same request. A key reused with a
   * materially different body is a client bug, not a network retry —
   * surface it instead of silently handing back an unrelated payment.
   * Same reasoning as `PaymentAllocationService`'s private method of the
   * same name; duplicated rather than shared because the two DTOs (line
   * shape, wallet fields) don't overlap enough to make one signature
   * clean.
   */
  private assertIdempotentReplayMatches(existing: Payment, dto: CheckoutDto): void {
    const existingLines = (existing.allocations ?? [])
      .map((a) => ({
        student_fee_id: a.student_fee_id,
        amount: round2(Number(a.allocated_amount)),
        one_off_discount: round2(Number(a.discount_amount ?? 0)),
      }))
      .sort((a, b) => a.student_fee_id.localeCompare(b.student_fee_id));
    const dtoLines = dto.lines
      .map((l) => ({
        student_fee_id: l.student_fee_id,
        amount: round2(Number(l.amount)),
        one_off_discount: round2(Number(l.one_off_discount ?? 0)),
      }))
      .sort((a, b) => a.student_fee_id.localeCompare(b.student_fee_id));
    const linesMatch =
      existingLines.length === dtoLines.length &&
      existingLines.every(
        (l, i) =>
          l.student_fee_id === dtoLines[i].student_fee_id &&
          Math.abs(l.amount - dtoLines[i].amount) <= AMOUNT_EPSILON &&
          Math.abs(l.one_off_discount - dtoLines[i].one_off_discount) <= AMOUNT_EPSILON,
      );

    const mismatch =
      existing.payment_method !== dto.payment_method ||
      (existing.transaction_reference ?? null) !== (dto.transaction_reference ?? null) ||
      (existing.remarks ?? null) !== (dto.remarks ?? null) ||
      Math.abs(Number(existing.wallet_credit_used ?? 0) - round2(dto.wallet_use ?? 0)) >
        AMOUNT_EPSILON ||
      Math.abs(Number(existing.tendered_amount ?? 0) - round2(dto.tendered_amount ?? 0)) >
        AMOUNT_EPSILON ||
      !linesMatch;

    if (mismatch) {
      throw new BadRequestException(
        `idempotency_key "${dto.idempotency_key}" was already used for a different checkout request`,
      );
    }
  }

  private async findByIdempotencyKey(tenantId: string, key: string): Promise<Payment | null> {
    return this.paymentRepo.findOne({
      where: { tenant_id: tenantId, idempotency_key: key },
      relations: ['allocations', 'allocations.student_fee', 'invoice'],
    });
  }

  /**
   * Makes the documented "payment committed, invoice creation failed"
   * gap (see the comment above the main flow's call site) recoverable
   * instead of permanent: every return path — the main flow, a fresh
   * idempotency replay, and both concurrent-transaction race outcomes —
   * routes through here first. A payment that already has an invoice is
   * returned untouched; one that doesn't gets exactly one repair attempt
   * per call.
   *
   * Two requests can reach this for the same orphaned payment at nearly
   * the same time (e.g. two rapid retries of the same idempotency key
   * after the first invoice-creation attempt failed) — a session-level
   * `pg_advisory_lock` scoped to the payment id serializes them, so a
   * race never mints two invoices for one payment. The lock key is a
   * plain string hashed by Postgres itself (`hashtext`), not a `bigint`
   * id, so no separate keyspace bookkeeping is needed.
   *
   * Session-level advisory locks are tied to the *connection*, not the
   * transaction, so acquiring and releasing them through the default
   * `EntityManager` (which can pull a different pooled connection per
   * call) would silently no-op the unlock and leak the lock on whichever
   * connection actually held it. A dedicated `QueryRunner` pins both
   * calls — and the repair work in between — to one connection.
   *
   * The lock is the *blocking* variant, not `pg_try_advisory_lock`: a
   * caller that loses the race waits for the winner to finish rather
   * than racing ahead with a stale "no invoice yet" read, so two
   * concurrent replays of the same orphaned payment both come back with
   * the repaired invoice, not just one of them.
   */
  private async ensureInvoiceLinked(paymentId: string): Promise<Payment> {
    const loaded = await this.paymentRepo.findOneOrFail({
      where: { id: paymentId },
      relations: [
        'allocations',
        'allocations.student_fee',
        'allocations.student_fee.fee_structure',
        'invoice',
      ],
    });
    if (loaded.invoice_id) return loaded;

    const lockKey = `checkout-invoice-repair:${paymentId}`;
    const queryRunner = this.paymentRepo.manager.connection.createQueryRunner();
    await queryRunner.connect();
    try {
      // The advisory lock itself is connection-scoped, not
      // transaction-scoped, so it's acquired/released outside the
      // transaction below. But `InvoicesService.create` →
      // `lockSchoolForSnapshot` takes a pessimistic row lock
      // (`SELECT ... FOR UPDATE`/`FOR SHARE`), which TypeORM refuses to
      // run without an open transaction on the manager — so the repair
      // work itself must happen inside a started/committed/rolled-back
      // transaction on this same queryRunner.
      await queryRunner.query(`SELECT pg_advisory_lock(hashtext($1))`, [lockKey]);
      try {
        await queryRunner.startTransaction();
        try {
          // Re-read under the lock: the concurrent repairer may have just
          // finished between the check above and acquiring the lock.
          const fresh = await queryRunner.manager.findOneOrFail(Payment, {
            where: { id: paymentId },
            relations: [
              'allocations',
              'allocations.student_fee',
              'allocations.student_fee.fee_structure',
              'invoice',
            ],
          });
          if (fresh.invoice_id) {
            await queryRunner.commitTransaction();
            return fresh;
          }

          // [16.5.1] `InvoicesService.create` now builds the snapshot itself
          // from the payment's already-committed allocations — it just
          // needs the paymentId and the manager already open here (this
          // repair runs inside its own advisory-locked queryRunner
          // transaction, same as before).
          const invoice = await this.invoicesService.create(fresh.id, queryRunner.manager);
          await queryRunner.manager.update(Payment, fresh.id, { invoice_id: invoice.id });
          fresh.invoice_id = invoice.id;
          fresh.invoice = invoice;
          await queryRunner.commitTransaction();
          return fresh;
        } catch (err) {
          await queryRunner.rollbackTransaction();
          throw err;
        }
      } finally {
        await queryRunner.query(`SELECT pg_advisory_unlock(hashtext($1))`, [lockKey]);
      }
    } finally {
      await queryRunner.release();
    }
  }

  private async toResult(payment: Payment, tenantId: string): Promise<CheckoutResultDto> {
    const walletBalanceAfter = await this.walletService.balance(payment.student_id, tenantId);
    return {
      payment,
      invoice_id: payment.invoice_id ?? '',
      invoice_number: payment.invoice?.invoice_number ?? '',
      change_amount: Number(payment.change_amount),
      wallet_balance_after: walletBalanceAfter,
    };
  }
}
