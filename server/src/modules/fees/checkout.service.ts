import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { emitRecheck } from '../attention/engine/attention-events';
import { attentionEvents } from '../attention/attention.constants';
import { enqueueFeeNotify, FEE_NOTIFY_QUEUE } from '../communications/communications.constants';
import {
  Injectable,
  Logger,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  AuditAction,
  ApprovalScope,
  FeeStatus,
  PaymentAllocationType,
  PaymentMethod,
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
import { SchoolsService } from '../schools/schools.service';
import { DEFAULT_REGION_SETTINGS } from '../schools/settings/tenant-settings-defaults';
import { localDate, localToday } from '../attendance/attendance-policy.util';
import { toPaisa } from '../../common/constants/money';

// One text for foreign, deleted and unknown ids, with no id in it (Rule 23, #2640).
const STUDENT_FEE_NOT_FOUND = 'Student fee not found';
const PAYABLE_STATUSES: FeeStatus[] = [
  FeeStatus.PENDING,
  FeeStatus.PARTIALLY_PAID,
  FeeStatus.OVERDUE,
];

function dateKey(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Payload of the `payments.recorded` receipt job on `FEE_NOTIFY_QUEUE` [68.4.10]. */
export interface PaymentsRecordedEvent {
  payment_id: string;
  tenant_id: string;
  student_ids: string[];
}

/** True when `err` is specifically a unique-violation on the
 * `(tenant_id, idempotency_key)` partial index on `payments`. */
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
 * Unlike the removed single-student, FIFO-only payment path (#2649), a checkout line names its own bill and amount directly — the
 * cart (16.4.1) is what suggests those amounts, this endpoint just applies
 * whatever the caller confirms.
 */
@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);

  constructor(
    @InjectQueue(FEE_NOTIFY_QUEUE) private readonly feeNotifyQueue: Queue,
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
    @InjectRepository(Student)
    private readonly studentRepo: Repository<Student>,
    private readonly walletService: WalletService,
    private readonly approvalService: ApprovalService,
    private readonly auditService: AuditService,
    private readonly invoicesService: InvoicesService,
    private readonly schoolsService: SchoolsService,
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
      // The usual retry path: the first request may have died after commit but
      // before its after-commit work. The jobId makes a repeat harmless.
      await this.afterCommit(repaired, tenantId, userId);
      return this.toResult(repaired, tenantId);
    }

    const lineFeeIds = dto.lines.map((l) => l.student_fee_id);
    if (new Set(lineFeeIds).size !== lineFeeIds.length) {
      throw new BadRequestException('Duplicate student_fee_id in lines');
    }

    // Read before the bill locks: `getResolvedSettings` uses its own pool connection, and a
    // checkout holding locks while it waits for a connection can starve the pool (#2295).
    const settings = await this.schoolsService.getResolvedSettings(tenantId);
    const tz = settings.region?.timezone ?? DEFAULT_REGION_SETTINGS.timezone;
    // The school's own date: the back-dating window and the DUE/CURRENT split both use it.
    const todayKey = localToday(tz);

    const { paymentId, duplicateKey, winnerId } = await this.paymentRepo.manager.transaction(
      async (manager) => {
        const studentFeeRepo = manager.getRepository(StudentFee);
        const paymentRepo = manager.getRepository(Payment);
        const allocationRepo = manager.getRepository(PaymentAllocation);

        // Lock every bill this checkout touches (`.setLock('pessimistic_write')`)
        // so two concurrent checkouts against the same bill
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
          // Tenant scope inside the lock: `student_fees` has no tenant_id, so go through the student
          // with a subquery (a join would also lock the students rows). A foreign id is never locked
          // and falls through to the same 404 as a missing one.
          .andWhere(
            'sf.student_id IN (SELECT st.id FROM students st WHERE st.tenant_id = :tenantId)',
            {
              tenantId,
            },
          )
          .orderBy('sf.id', 'ASC')
          .setLock('pessimistic_write')
          .getMany();

        const bills = await studentFeeRepo.find({
          where: { id: In(lockedBills.map((b) => b.id)) },
          relations: ['student', 'fee_structure'],
        });

        // Re-check idempotency now that the bill locks are held — a truly
        // simultaneous duplicate request blocks here until the winner
        // commits.
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
            throw new NotFoundException(STUDENT_FEE_NOT_FOUND);
          }
          // `bill.student` can be null when the student relation was
          // soft-deleted — TypeORM's relation join auto-filters
          // `deleted_at IS NULL`, so the FK still resolves but the object
          // doesn't. Guard before dereferencing rather than letting a
          // TypeError bubble up as an unhandled 500.
          if (!bill.student) {
            throw new NotFoundException(STUDENT_FEE_NOT_FOUND);
          }
          if (bill.student.tenant_id !== tenantId || bill.student.deleted_at) {
            throw new NotFoundException(STUDENT_FEE_NOT_FOUND);
          }
          const balancePaisa =
            toPaisa(bill.total_amount) - toPaisa(bill.discount_amount) - toPaisa(bill.paid_amount);
          // A settled bill (PAID / WAIVED / nothing left) is a conflict, not a missing row (#2592).
          // The text carries no bill id (Rule 23).
          if (!PAYABLE_STATUSES.includes(bill.status) || balancePaisa <= 0) {
            throw new ConflictException({
              message: 'This fee has no outstanding balance',
              details: { code: 'CHECKOUT_FEE_SETTLED' },
            });
          }
          const requestedPaisa = toPaisa(line.amount) + toPaisa(line.one_off_discount ?? 0);
          if (requestedPaisa > balancePaisa) {
            // Fixed text: no submitted amount, no balance (Rule 23). The UI has the balance from the dues read.
            throw new BadRequestException({
              message: 'The amount is more than the outstanding balance',
              details: { code: 'CHECKOUT_AMOUNT_EXCEEDS_BALANCE' },
            });
          }
        }

        const primaryStudentId = billsById.get(dto.lines[0].student_fee_id)!.student_id;
        const totalPaisa = dto.lines.reduce((sum, l) => sum + toPaisa(l.amount), 0);
        const walletPaisa = toPaisa(dto.wallet_use ?? 0);
        const totalAmount = totalPaisa / 100;
        const walletUse = walletPaisa / 100;
        const changeHandling = dto.change_handling ?? 'RETURN';

        const distinctStudentIds = new Set(
          dto.lines.map((l) => billsById.get(l.student_fee_id)!.student_id),
        );

        if (walletUse > 0) {
          // Wallets are strictly per-student (see
          // `checkout-cart.service.ts`'s documented invariant around line
          // 234): `wallet_use` only ever debits the primary line's
          // student, so refuse it outright when the lines span more than
          // one student rather than silently applying one student's money
          // to another's bill. Multi-student wallet allocation is out of
          // scope for this ticket.
          if (distinctStudentIds.size > 1) {
            throw new BadRequestException(
              'wallet_use cannot be combined with a checkout that spans more than one student',
            );
          }

          if (walletPaisa > totalPaisa) {
            throw new BadRequestException('wallet_use cannot exceed the sum of the checkout lines');
          }

          // Row lock (bills are already locked, so the order is bills -> wallet,
          // same as debit and reversal): a concurrent spend now fails here,
          // before any approval token below is burned (F-153).
          const wallet = await this.walletService.getOrCreate(primaryStudentId, tenantId, manager);
          if (walletPaisa > toPaisa(wallet.balance)) {
            throw new BadRequestException('wallet_use exceeds the student wallet balance');
          }
        }

        const tenderedPaisa =
          dto.tendered_amount != null
            ? toPaisa(dto.tendered_amount)
            : Math.max(0, totalPaisa - walletPaisa);
        const changePaisa = walletPaisa + tenderedPaisa - totalPaisa;
        const change = changePaisa / 100;
        // Only cash makes change: a card / bKash tender above the amount due is a client error.
        if (dto.payment_method !== PaymentMethod.CASH && tenderedPaisa > totalPaisa - walletPaisa) {
          throw new BadRequestException('Only a cash payment can be more than the amount due');
        }
        if (changePaisa < 0) {
          throw new BadRequestException(
            'wallet_use + tendered_amount must cover the sum of the checkout lines',
          );
        }
        // Change goes to one wallet; with siblings it would land on the first
        // line's student only (F-155).
        if (changeHandling === 'TO_WALLET' && changePaisa > 0 && distinctStudentIds.size > 1) {
          throw new BadRequestException(
            'change_handling TO_WALLET cannot be combined with a checkout that spans more than one student',
          );
        }

        // Every validation that can still fail the request has run by this
        // point. `approvalService.consume()` is an irreversible Redis
        // GETDEL — burn the token last, as the final gate before writes,
        // so a request that fails validation never wastes a legitimately
        // granted approval.
        // MON-11: today, or up to 3 calendar days back (back-dating needs approval).
        // "Today" is the school's own date (#2295). A bare 'YYYY-MM-DD' is already
        // that calendar day; an instant is read in the school's time zone.
        let backdatedTo: string | null = null;
        if (dto.payment_date) {
          const day = /^\d{4}-\d{2}-\d{2}$/.test(dto.payment_date)
            ? dto.payment_date
            : localDate(new Date(dto.payment_date), tz);
          const earliest = new Date(`${todayKey}T00:00:00Z`);
          earliest.setUTCDate(earliest.getUTCDate() - 3);
          if (day > todayKey) {
            throw new BadRequestException('payment_date cannot be in the future');
          }
          if (day < earliest.toISOString().slice(0, 10)) {
            throw new BadRequestException('payment_date can be at most 3 days back');
          }
          if (day < todayKey) backdatedTo = day;
        }

        const hasDiscount = dto.lines.some((l) => (l.one_off_discount ?? 0) > 0);
        // One approval token carries one scope, and a back-dated discount would
        // need two. Refuse up front, before any token is burned.
        if (backdatedTo && hasDiscount) {
          throw new BadRequestException('a back-dated checkout cannot carry a one-off discount');
        }
        let approvedByUserId: string | null = null;
        const approvalScope = backdatedTo
          ? ApprovalScope.PAYMENTS_BACKDATE
          : ApprovalScope.FEES_DISCOUNT;
        if (hasDiscount) {
          const approval = await this.approvalService.consume(request, ApprovalScope.FEES_DISCOUNT);
          approvedByUserId = approval.approverId;
        }

        let backdateApproverId: string | null = null;
        if (backdatedTo) {
          const approval = await this.approvalService.consume(
            request,
            ApprovalScope.PAYMENTS_BACKDATE,
          );
          backdateApproverId = approval.approverId;
          approvedByUserId = backdateApproverId;
        }

        const now = dto.payment_date ? new Date(dto.payment_date) : new Date();

        // [15.5.5] Frozen at the moment of record — same reasoning as
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
            dueKey !== null && dueKey < todayKey
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
        if (changeHandling === 'TO_WALLET' && changePaisa > 0) {
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
            ...(backdatedTo
              ? { backdated_to: backdatedTo, backdate_approved_by_user_id: backdateApproverId }
              : {}),
          },
        };
        if (approvedByUserId) {
          await this.auditService.recordApproved(
            {
              ...auditPayload,
              approved_by_user_id: approvedByUserId,
              approval_scope: approvalScope,
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
      // The winner may have died before its own after-commit work; the jobId and the
      // reference_key make repeating it harmless.
      await this.afterCommit(repaired, tenantId, userId);
      return this.toResult(repaired, tenantId);
    }

    let finalPaymentId = paymentId;
    if (duplicateKey) {
      if (meta) meta.replayed = true;
      const winner = await this.findByIdempotencyKey(tenantId, duplicateKey);
      if (!winner) {
        throw new BadRequestException(
          'This idempotency key conflicted with an existing payment that could not be re-read',
        );
      }
      // Two simultaneous requests with one key and different bodies: the loser must not get the
      // winner's payment as if it were its own (#2637, F-125).
      this.assertIdempotentReplayMatches(winner, dto);
      const repaired = await this.ensureInvoiceLinked(winner.id);
      await this.afterCommit(repaired, tenantId, userId);
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

    await this.afterCommit(payment, tenantId, userId);

    return {
      payment,
      invoice_id: payment.invoice_id ?? '',
      invoice_number: payment.invoice?.invoice_number ?? '',
      change_amount: Number(payment.change_amount),
      wallet_balance_after: walletBalanceAfter,
    };
  }

  /** Receipt notice job + fee-alert rechecks, after the payment is committed. Safe to repeat. */
  private async afterCommit(payment: Payment, tenantId: string, userId: string): Promise<void> {
    await enqueueFeeNotify(this.feeNotifyQueue, this.logger, 'payments.recorded', payment.id, {
      payment_id: payment.id,
      tenant_id: tenantId,
      // `student_fee` is null for a bill removed after the payment (soft-deleted rows drop out
      // of the relation join); the payer still gets the receipt for money really received.
      student_ids: [
        ...new Set([
          payment.student_id,
          ...payment.allocations.flatMap((a) => (a.student_fee ? [a.student_fee.student_id] : [])),
        ]),
      ],
    } satisfies PaymentsRecordedEvent);
    emitRecheck(attentionEvents, { tenantId, ruleKey: 'fees.overdue_family', actorUserId: userId });
    emitRecheck(attentionEvents, { tenantId, ruleKey: 'fees.due_soon', actorUserId: userId });
  }

  /**
   * A genuine retry replays the exact same request. A key reused with a
   * materially different body is a client bug, not a network retry —
   * surface it instead of silently handing back an unrelated payment.
   */
  private assertIdempotentReplayMatches(existing: Payment, dto: CheckoutDto): void {
    // Cheap first (#2637): a reversed payment is never handed back as if it were live.
    if (existing.reversed_by_payment_id || existing.payment_status === PaymentStatus.REFUNDED) {
      throw new ConflictException({
        message: 'This payment was reversed. Start a new checkout',
        details: { code: 'CHECKOUT_PAYMENT_REVERSED' },
      });
    }
    // PENDING / FAILED: checkout only writes SUCCESS today, but a future gateway payment must
    // not be called "reversed".
    if (existing.payment_status !== PaymentStatus.SUCCESS) {
      throw new ConflictException({
        message: 'This payment is not complete. Start a new checkout',
        details: { code: 'CHECKOUT_PAYMENT_NOT_COMPLETE' },
      });
    }
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
          toPaisa(l.amount) === toPaisa(dtoLines[i].amount) &&
          toPaisa(l.one_off_discount) === toPaisa(dtoLines[i].one_off_discount),
      );

    // `change_handling` is not stored: infer it. With no change at all the two are the same thing.
    const toWallet = (dto.change_handling ?? 'RETURN') === 'TO_WALLET';
    const changeHandlingDiffers = toWallet
      ? toPaisa(existing.change_amount ?? 0) > 0
      : toPaisa(existing.wallet_credit_added ?? 0) > 0;
    // ponytail: a replay that omits payment_date while the first was back-dated is not caught; add a created_at comparison if cashiers ever hit it.
    const paymentDateDiffers =
      !!dto.payment_date && dateKey(existing.payment_date) !== dateKey(new Date(dto.payment_date));

    const mismatch =
      existing.payment_method !== dto.payment_method ||
      (existing.transaction_reference ?? null) !== (dto.transaction_reference ?? null) ||
      (existing.remarks ?? null) !== (dto.remarks ?? null) ||
      toPaisa(existing.wallet_credit_used ?? 0) !== toPaisa(dto.wallet_use ?? 0) ||
      toPaisa(existing.tendered_amount ?? 0) !== toPaisa(dto.tendered_amount ?? 0) ||
      changeHandlingDiffers ||
      paymentDateDiffers ||
      !linesMatch;

    if (mismatch) {
      throw new BadRequestException(
        'This idempotency key was already used for a different checkout request',
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
