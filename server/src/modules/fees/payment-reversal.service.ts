import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Not, Repository } from 'typeorm';
import {
  AuditAction,
  ApprovalScope,
  FeeStatus,
  PaymentStatus,
  Permission,
  STAFF_ROLES,
  UserRole,
  UserStatus,
  WalletTransactionKind,
  roleHasPermission,
} from '@biddaloy/shared';
import { round2, toPaisa } from '../../common/constants/money';
import { Payment } from './entities/payment.entity';
import { PaymentAllocation } from './entities/payment-allocation.entity';
import { StudentFee } from './entities/student-fee.entity';
import { WalletTransaction } from './entities/wallet-transaction.entity';
import { StudentWallet } from './entities/student-wallet.entity';
import { WalletService } from './wallet.service';
import { AuditService } from '../audit/audit.service';
import { InvoicesService } from '../invoices/invoices.service';
import { SchoolsService } from '../schools/schools.service';
import { UserTenant } from '../auth/entities/user-tenant.entity';
import { emitRecheck } from '../attention/engine/attention-events';
import { attentionEvents } from '../attention/attention.constants';

interface UndoneDebitAudit {
  debit_id: string;
  amount: number;
  student_fee_id: string | null;
  paid_amount_before?: number;
  paid_amount_after?: number;
  status_before?: FeeStatus;
  status_after?: FeeStatus;
}

/** [78 D1/D23] The school roles that can approve a reversal. SUPER_ADMIN is a
 * platform role and does not count as "another approver" in a school. Bound
 * with `In(...)`, never string-joined (Rule 4). */
const FEE_APPROVER_ROLES = STAFF_ROLES.filter(
  (r) => r !== UserRole.SUPER_ADMIN && roleHasPermission(r, Permission.FEE_APPROVE),
);

/** [78 D1] A self-approved reversal was refused. Fixed text, no ids (Rule 23). */
export class SecondApproverRequiredException extends ForbiddenException {
  constructor() {
    super({
      message: 'Another approver is needed for this reversal',
      details: { code: 'SECOND_APPROVER_REQUIRED' },
    });
  }
}

/** Thrown by the reverse-in-order precondition (D10) — 409 with the
 * payment ids the caller must reverse first. */
export class ReverseLaterPaymentsFirstException extends ConflictException {
  constructor(paymentIds: string[]) {
    super({ code: 'REVERSE_LATER_PAYMENTS_FIRST', payment_ids: paymentIds });
  }
}

/**
 * `POST /payments/:id/reverse` (16.6.1) — undoes a recorded payment in
 * full: unwinds the wallet movements it made, restores the bills it paid
 * toward, cancels the invoice it produced (via a credit note), and marks
 * the original payment as reversed. Mirrors the shape `CheckoutService`
 * established for the forward flow, just run backwards.
 *
 * Approval (`ApprovalScope.PAYMENTS_REVERSE`, D9) is consumed by
 * `ApprovalGuard` at the controller boundary — this service receives the
 * already-resolved `approverUserId`, the same split `CheckoutService`
 * doesn't need (it consumes approval itself, since its approval is
 * conditional on `one_off_discount`) but that fits a route where the
 * approval is unconditional.
 */
@Injectable()
export class PaymentReversalService {
  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
    private readonly walletService: WalletService,
    private readonly auditService: AuditService,
    private readonly invoicesService: InvoicesService,
    private readonly schoolsService: SchoolsService,
  ) {}

  async reverse(
    paymentId: string,
    tenantId: string,
    actorUserId: string,
    approverUserId: string,
    reason: string,
  ): Promise<Payment> {
    const payment = await this.paymentRepo.findOne({
      where: { id: paymentId, tenant_id: tenantId },
      relations: ['allocations', 'allocations.student_fee', 'invoice'],
    });
    if (!payment) {
      throw new NotFoundException('Payment not found');
    }
    this.assertReversible(payment);

    // [78 D1] Self-approval is allowed only in a single-admin school, and
    // never when the school asks for a second person. Checked before any lock
    // or money row. The approval token `ApprovalGuard` consumed is already
    // spent: the remedy is to run step-up again with another approver.
    const selfApproved = approverUserId === actorUserId;
    if (selfApproved) {
      await this.assertSelfApprovalAllowed(tenantId, actorUserId);
    }

    // A cheap pre-check outside the transaction — cuts an obviously
    // doomed request off before it pays for a transaction and a wallet
    // lock. It is NOT the real guard: see the re-check under the wallet
    // row lock below, which is what actually prevents the race.
    const preRemovedCredits = await this.removedBillCredits(this.paymentRepo.manager, payment.id);
    await this.assertAllWalletsInOrder(payment, preRemovedCredits);

    const reversalPaymentId = await this.paymentRepo.manager.transaction(async (manager) => {
      const paymentRepo = manager.getRepository(Payment);
      const allocationRepo = manager.getRepository(PaymentAllocation);
      const studentFeeRepo = manager.getRepository(StudentFee);

      // Re-fetch and lock the original payment now that we're inside the
      // transaction — a concurrent reversal request for the same payment
      // blocks here until the winner commits, same reasoning as
      // `CheckoutService`'s idempotency re-check under lock.
      const locked = await paymentRepo
        .createQueryBuilder('payment')
        .where('payment.id = :id', { id: payment.id })
        .andWhere('payment.tenant_id = :tenantId', { tenantId })
        .setLock('pessimistic_write')
        .getOne();
      if (!locked) {
        throw new NotFoundException('Payment not found');
      }
      this.assertReversible(locked);

      // Lock every bill this payment allocated against, plus (MON-14) the
      // bills fee generation may have paid from the wallet, BEFORE the wallet
      // lock below — `CheckoutService` locks bills (`ORDER BY sf.id ASC`)
      // then the wallet (`WalletService.getOrCreate`), so taking these in
      // the opposite order here would be a classic ABBA lock inversion: a
      // concurrent checkout and reversal on the same student could each
      // hold one lock and wait on the other, a Postgres 40P01 deadlock.
      // ONE batch in the same deterministic `sf.id ASC` order as checkout:
      // two separately sorted batches can still interleave with checkout's
      // single pass and deadlock. `withDeleted` because a bill can have been
      // soft-deleted since this payment was recorded — its paid_amount still
      // needs unwinding even though it's gone.
      // The generation candidates come from an unlocked read (removed-bill
      // credits from the pre-check above). `undoGenerationDebits` re-selects
      // under the wallet lock and returns a retryable 409 if it then picks a
      // bill that is not locked here.
      const feeIds = payment.allocations.map((a) => a.student_fee_id);
      const candidateOwners = await this.walletOwners(manager, preRemovedCredits);
      const generationBillIds = await this.generationBillIds(
        manager,
        payment,
        [payment.student_id, ...candidateOwners.values()],
        tenantId,
      );
      const lockIds = [...new Set([...feeIds, ...generationBillIds])];
      const lockedBills =
        lockIds.length > 0
          ? await studentFeeRepo
              .createQueryBuilder('sf')
              .withDeleted()
              .where('sf.id IN (:...ids)', { ids: lockIds })
              .andWhere(
                'sf.student_id IN (SELECT s.id FROM students s WHERE s.tenant_id = :tenantId)',
                { tenantId },
              )
              .orderBy('sf.id', 'ASC')
              .setLock('pessimistic_write')
              .getMany()
          : [];
      const billsById = new Map(lockedBills.map((b) => [b.id, b]));

      // D10, re-checked for real this time (after the bill locks above,
      // matching `CheckoutService`'s bills-then-wallet order): the
      // pre-check before the transaction ran against an unlocked wallet
      // balance, so two concurrent reversals for the same student (e.g.
      // reversing payment A here while another request reverses payment
      // B, the payment that spent A's wallet credit) could both pass it
      // and both proceed. `getOrCreate` takes a `pessimistic_write` lock
      // on the student's wallet row, so this second check — running
      // against a balance no concurrent debit/credit/reversal for this
      // student can change out from under it — is what actually prevents
      // the wallet balance from going negative.
      // MON-03: credits made when this payment's bill was removed count too.
      // They sit in the wallet of the bill's owner, which for a multi-student
      // payment may not be the payer's. Read under the bill locks so a
      // concurrent removal cannot add one unseen.
      const removedCredits = await this.removedBillCredits(manager, payment.id);
      const studentOfWallet = await this.walletOwners(manager, removedCredits);
      const shortfalls = await this.assertAllWalletsInOrder(
        locked,
        removedCredits,
        manager,
        studentOfWallet,
        tenantId,
      );

      // MON-14: the wallet change was spent only by fee generation — undo that
      // auto-apply (re-opening the bills) so the wallet can cover this reversal.
      const undone = await this.undoGenerationDebits(
        manager,
        payment,
        shortfalls,
        new Set(billsById.keys()),
        tenantId,
        actorUserId,
      );
      // The audit's "before" is the bill as it stood before this reversal,
      // captured before the F-152 patch below rewrites paid_amount/status.
      const billBefore = new Map(
        lockedBills.map((b) => [b.id, { paid: Number(b.paid_amount), status: b.status }]),
      );
      // F-152: undoing a debit lowered paid_amount on a bill this payment may
      // also have allocated; the allocation loop must start from that value.
      for (const d of undone.undone_generation_debits) {
        const bill = d.student_fee_id ? billsById.get(d.student_fee_id) : undefined;
        if (bill && d.paid_amount_after != null) {
          bill.paid_amount = d.paid_amount_after;
          if (d.status_after) bill.status = d.status_after;
        }
      }

      const billAudit: {
        student_fee_id: string;
        paid_amount_before: number;
        paid_amount_after: number;
        status_before: FeeStatus;
        status_after: FeeStatus;
        bill_soft_deleted: boolean;
      }[] = [];

      for (const allocation of payment.allocations) {
        const bill = billsById.get(allocation.student_fee_id);
        if (!bill) continue; // Bill hard-deleted or otherwise gone — nothing left to unwind.

        const newPaid = round2(Number(bill.paid_amount) - Number(allocation.allocated_amount));
        const newDiscount = round2(
          Number(bill.discount_amount) - Number(allocation.discount_amount),
        );
        const newOneOff = round2(
          Number(bill.one_off_discount_amount) - Number(allocation.discount_amount),
        );

        // A bill that was soft-deleted after this payment isn't brought
        // back into the live workflow by reversing the payment — its
        // status is left untouched, but the money it "held" is still
        // unwound and the fact it happened against a deleted bill is
        // flagged in the audit trail rather than silently recomputing a
        // status nobody will act on.
        const before = billBefore.get(bill.id)!;
        const statusBefore = before.status;
        let statusAfter = bill.status;
        if (!bill.deleted_at) {
          const remaining = round2(Number(bill.total_amount) - newPaid - newDiscount);
          statusAfter =
            toPaisa(remaining) <= 0
              ? FeeStatus.PAID
              : toPaisa(newPaid) > 0
                ? FeeStatus.PARTIALLY_PAID
                : FeeStatus.PENDING;
        }

        await studentFeeRepo.update(bill.id, {
          paid_amount: newPaid,
          discount_amount: newDiscount,
          one_off_discount_amount: newOneOff,
          ...(bill.deleted_at ? {} : { status: statusAfter }),
        });

        billAudit.push({
          student_fee_id: bill.id,
          paid_amount_before: before.paid,
          paid_amount_after: newPaid,
          status_before: statusBefore,
          status_after: statusAfter,
          bill_soft_deleted: Boolean(bill.deleted_at),
        });
      }

      // Wallet unwind: withdraw whatever this payment put into the
      // wallet (change routed TO_WALLET), refund whatever this payment
      // took out of the wallet (wallet_use at checkout) — the mirror
      // image of `CheckoutService.checkout`'s debit/credit pair.
      const walletCreditAdded = round2(Number(payment.wallet_credit_added));
      const walletCreditUsed = round2(Number(payment.wallet_credit_used));
      if (walletCreditAdded > 0) {
        await this.walletService.debit(
          {
            studentId: payment.student_id,
            tenantId,
            amount: walletCreditAdded,
            kind: WalletTransactionKind.REVERSAL,
            paymentId: payment.id,
            reversalOfId: payment.id,
            createdByUserId: actorUserId,
            note: `Reversal of payment ${payment.id}`,
            allowDeletedStudent: true,
          },
          manager,
        );
      }
      const removedBillDebits: Array<{
        student_id: string;
        wallet_id: string;
        credit_transaction_id: string;
        amount: number;
      }> = [];
      for (const credit of removedCredits) {
        removedBillDebits.push({
          student_id: studentOfWallet.get(credit.wallet_id)!,
          wallet_id: credit.wallet_id,
          credit_transaction_id: credit.id,
          amount: Math.abs(Number(credit.amount)),
        });
        await this.walletService.debit(
          {
            studentId: studentOfWallet.get(credit.wallet_id)!,
            tenantId,
            amount: Math.abs(Number(credit.amount)),
            kind: WalletTransactionKind.REVERSAL,
            paymentId: payment.id,
            studentFeeId: credit.student_fee_id,
            reversalOfId: credit.id,
            createdByUserId: actorUserId,
            note: `Reversal of payment ${payment.id}`,
            allowDeletedStudent: true,
          },
          manager,
        );
      }
      if (walletCreditUsed > 0) {
        await this.walletService.credit(
          {
            studentId: payment.student_id,
            tenantId,
            amount: walletCreditUsed,
            kind: WalletTransactionKind.REVERSAL,
            paymentId: payment.id,
            reversalOfId: payment.id,
            createdByUserId: actorUserId,
            note: `Reversal of payment ${payment.id}`,
            allowDeletedStudent: true,
          },
          manager,
        );
      }

      // The reversal itself is a new Payment row — append-only, same
      // reasoning as `wallet_transactions`: the original record is
      // never rewritten to look like it didn't happen, a compensating
      // entry points back at it instead. `payments.total_amount` and
      // `payment_allocations.allocated_amount` both carry a DB check
      // constraint requiring a positive value (`CHK_pay_total_amount`,
      // `CHK_pa_allocated_amount`), so the reversal row mirrors the
      // original amount rather than negating it — `reversal_of_payment_id`
      // is what marks it as a reversal, not the sign.
      const reversal = await paymentRepo.save(
        paymentRepo.create({
          student_id: payment.student_id,
          total_amount: Number(payment.total_amount),
          payment_method: payment.payment_method,
          payment_status: PaymentStatus.REFUNDED,
          transaction_reference: payment.transaction_reference,
          remarks: reason,
          received_by_user_id: actorUserId,
          approved_by_user_id: approverUserId,
          payment_date: new Date(),
          tenant_id: tenantId,
          reversal_of_payment_id: payment.id,
          reversal_reason: reason,
        }),
      );

      await allocationRepo.save(
        payment.allocations.map((a) =>
          allocationRepo.create({
            payment_id: reversal.id,
            student_fee_id: a.student_fee_id,
            allocated_amount: Number(a.allocated_amount),
            allocation_type: a.allocation_type,
            discount_amount: Number(a.discount_amount),
          }),
        ),
      );

      await paymentRepo.update(payment.id, {
        reversed_by_payment_id: reversal.id,
        payment_status: PaymentStatus.REFUNDED,
      });

      // Cancel the invoice this payment produced, if any — mints a
      // credit note and flips the original invoice to CANCELLED.
      // `createCreditNote` throws NotFoundException when there's no live
      // INVOICE for this payment — either it never had one (e.g. a
      // partial payment that never completed a bill) or, same lookup,
      // one that existed but was soft-deleted since. Both are legitimate
      // "nothing to cancel" cases here, not errors that should abort the
      // whole reversal transaction — `payment.invoice_id` alone can't
      // distinguish a live invoice from a soft-deleted one, so the
      // NotFoundException is the actual signal. `locked`, not `payment`: an
      // invoice minted after the first read is visible only under the row lock
      // (InvoicesService.create locks this same row).
      if (locked.invoice_id) {
        try {
          await this.invoicesService.createCreditNote(payment.id, reason, manager);
        } catch (error) {
          if (!(error instanceof NotFoundException)) throw error;
        }
      }

      await this.auditService.recordApproved(
        {
          action: AuditAction.UPDATE,
          entity_type: 'Payment',
          entity_id: payment.id,
          tenant_id: tenantId,
          performed_by_user_id: actorUserId,
          approved_by_user_id: approverUserId,
          approval_scope: ApprovalScope.PAYMENTS_REVERSE,
          old_values: {
            payment_status: payment.payment_status,
            bills: billAudit.map((b) => ({
              student_fee_id: b.student_fee_id,
              paid_amount: b.paid_amount_before,
              status: b.status_before,
            })),
          },
          new_values: {
            reversal_payment_id: reversal.id,
            reversal_reason: reason,
            self_approved: selfApproved,
            wallet_withdrawn: walletCreditAdded,
            removed_bill_wallet_debits: removedBillDebits,
            wallet_refunded: walletCreditUsed,
            reopened_bill_ids: undone.reopened_bill_ids,
            undone_generation_debits: undone.undone_generation_debits,
            bills: billAudit.map((b) => ({
              student_fee_id: b.student_fee_id,
              paid_amount: b.paid_amount_after,
              status: b.status_after,
              bill_soft_deleted: b.bill_soft_deleted,
            })),
          },
        },
        manager,
      );

      return reversal.id;
    });

    const reversalPayment = await this.paymentRepo.findOneOrFail({
      where: { id: reversalPaymentId },
      relations: ['allocations'],
    });

    emitRecheck(attentionEvents, { tenantId, ruleKey: 'fees.overdue_family', actorUserId });
    emitRecheck(attentionEvents, { tenantId, ruleKey: 'fees.due_soon', actorUserId });

    return reversalPayment;
  }

  /** [78 D1] Throws when the actor approved their own reversal but the school
   * requires a second approver, or another active FEE_APPROVE holder exists.
   * Soft-deleted memberships are excluded by TypeORM's default. */
  private async assertSelfApprovalAllowed(tenantId: string, actorUserId: string): Promise<void> {
    const settings = await this.schoolsService.getResolvedSettings(tenantId);
    const requireSecond = settings.fees?.requireSecondApprover === true;
    const anotherApprover =
      requireSecond ||
      (await this.paymentRepo.manager.exists(UserTenant, {
        where: {
          tenant_id: tenantId,
          user_id: Not(actorUserId),
          role: In(FEE_APPROVER_ROLES),
          user: { status: UserStatus.ACTIVE },
        },
      }));
    if (anotherApprover) throw new SecondApproverRequiredException();
  }

  private assertReversible(payment: Payment): void {
    if (payment.reversal_of_payment_id) {
      throw new BadRequestException({
        code: 'CANNOT_REVERSE_A_REVERSAL',
        message: 'A reversal payment cannot itself be reversed',
      });
    }
    if (payment.reversed_by_payment_id) {
      throw new ConflictException({
        code: 'PAYMENT_ALREADY_REVERSED',
        message: 'This payment was already reversed',
      });
    }
    // Only a SUCCESS payment actually moved money and incremented
    // `student_fees.paid_amount` — `fees.service.ts` and the workbook
    // importer can both create PENDING/FAILED rows carrying allocations
    // that never touched a bill's `paid_amount`. Reversing one of those
    // anyway would subtract `allocated_amount` from a balance it never
    // added to (no DB check constraint stops `paid_amount` going
    // negative), recompute the wrong bill status, and mint a credit note
    // for money that was never collected.
    if (payment.payment_status !== PaymentStatus.SUCCESS) {
      throw new BadRequestException({
        code: 'PAYMENT_NOT_REVERSIBLE',
        message: `This payment has status "${payment.payment_status}" — only a SUCCESS payment can be reversed`,
      });
    }
  }

  /**
   * D10: a payment that routed change into the wallet (`wallet_credit_added
   * > 0`) can't be reversed once a later payment has spent that money —
   * doing so would walk the wallet balance negative. The wallet balance is
   * a running sum of every signed transaction, so removing this payment's
   * credit changes the balance by exactly `wallet_credit_added` regardless
   * of what happened in between; if that would take the balance below
   * zero, some later spend already depended on it.
   *
   * The payment ids surfaced in the 409 are diagnostic, not exhaustive: the
   * later payments (same student, `wallet_credit_used > 0`, recorded after
   * this one, not themselves already reversed) whose wallet spend — taken
   * in order — covers the shortfall.
   */
  /**
   * @param studentId Whose wallet is checked (the payer, or the owner of a removed bill).
   * @param creditAdded What this payment put into that wallet (change added, or removed-bill credits).
   * @param currentBalance When called under the wallet row lock (the real
   * check — see the call site inside the transaction), the caller passes
   * the already-locked balance so this doesn't take its own unlocked read.
   * The pre-check outside the transaction omits it and this falls back to
   * `WalletService.balance`.
   * @param manager When given, the "later payments" query runs inside the
   * caller's transaction against the same locked-consistent snapshot,
   * rather than a separate connection that could race with it.
   */
  private async assertReverseInOrder(
    payment: Payment,
    studentId: string,
    creditAdded: number,
    currentBalance?: number,
    manager?: EntityManager,
  ): Promise<number> {
    const balance =
      currentBalance ?? (await this.walletService.balance(studentId, payment.tenant_id));
    creditAdded = round2(creditAdded);
    const balanceAfterRemoval = round2(balance - creditAdded);
    if (toPaisa(balanceAfterRemoval) >= 0) return 0;

    const shortfall = round2(-balanceAfterRemoval);
    const paymentRepo = manager ? manager.getRepository(Payment) : this.paymentRepo;
    // "Later" = later `created_at`, NOT `payment_date`: a back-dated payment
    // (MON-11) can carry an earlier `payment_date` yet still have spent this
    // payment's wallet change. `created_at` is the inserting transaction's START
    // time (`now()`), not commit order, and ties sort by random uuid. A payment
    // that started before this one but committed after it is missed; the
    // reversal then fails safe with a 409.
    // ponytail: no monotonic column; add one (or clock_timestamp()) per #2425.
    const ordered = await paymentRepo.find({
      where: {
        tenant_id: payment.tenant_id,
        student_id: studentId,
      },
      order: { created_at: 'ASC', id: 'ASC' },
    });
    // `payment` is in the list only when `studentId` is the payer; otherwise
    // compare timestamps. Position (the `created_at, id` sort) wins over a
    // timestamp compare so a same-timestamp row still lands on one side.
    const paymentIndex = ordered.findIndex((p) => p.id === payment.id);
    const laterSpenders =
      paymentIndex !== -1
        ? ordered.slice(paymentIndex + 1)
        : ordered.filter((p) => +new Date(p.created_at) > +new Date(payment.created_at));

    const blockingIds: string[] = [];
    let covered = 0;
    for (const later of laterSpenders) {
      // Reversal rows don't spend wallet credit, and a payment already
      // reversed had its own spend refunded — neither is a real blocker,
      // and pointing the caller at one would just earn them a second
      // 409 (`PAYMENT_ALREADY_REVERSED`) on the payment this 409 named.
      if (later.reversal_of_payment_id || later.reversed_by_payment_id) continue;
      const used = round2(Number(later.wallet_credit_used));
      if (used <= 0) continue;
      blockingIds.push(later.id);
      covered = round2(covered + used);
      if (toPaisa(covered) >= toPaisa(shortfall)) break;
    }

    // MON-14: no later *payment* spent it — only fee generation's auto-apply
    // (`DEBIT_GENERATION`) did. Hand the shortfall back; `reverse` undoes those debits.
    if (blockingIds.length === 0) return shortfall;

    throw new ReverseLaterPaymentsFirstException(blockingIds);
  }

  /**
   * Live (not yet reversed) `DEBIT_GENERATION` rows of these wallets with
   * `created_at` after `after`, oldest first. `created_at` is the generation
   * transaction's start time, so a debit from a run that began before the
   * payment is missed (fails safe as a 409, see #2425).
   */
  private liveGenerationDebits(
    manager: EntityManager,
    walletIds: string[],
    tenantId: string,
    after: Date,
  ): Promise<WalletTransaction[]> {
    if (walletIds.length === 0) return Promise.resolve([]);
    return manager
      .getRepository(WalletTransaction)
      .createQueryBuilder('t')
      .where('t.wallet_id IN (:...walletIds)', { walletIds })
      .andWhere('t.tenant_id = :tenantId', { tenantId })
      .andWhere('t.kind = :kind', { kind: WalletTransactionKind.DEBIT_GENERATION })
      .andWhere('t.created_at > :after', { after })
      .andWhere(`NOT EXISTS (SELECT 1 FROM wallet_transactions r WHERE r.reversal_of_id = t.id)`)
      .orderBy('t.created_at', 'ASC')
      .addOrderBy('t.id', 'ASC')
      .getMany();
  }

  /**
   * MON-14: ids of the bills fee generation may have paid from these students'
   * wallets, read WITHOUT a lock. `reverse` locks them together with the
   * payment's own bills in one sorted batch, before any wallet lock.
   */
  private async generationBillIds(
    manager: EntityManager,
    payment: Payment,
    studentIds: string[],
    tenantId: string,
  ): Promise<string[]> {
    const wallets = await manager
      .getRepository(StudentWallet)
      .find({ where: { tenant_id: tenantId, student_id: In([...new Set(studentIds)]) } });
    const debits = await this.liveGenerationDebits(
      manager,
      wallets.map((w) => w.id),
      tenantId,
      payment.created_at,
    );
    return debits.map((d) => d.student_fee_id).filter((x): x is string => !!x);
  }

  /**
   * MON-14. For each wallet short by `shortfall`, reverse the oldest live
   * `DEBIT_GENERATION` rows made after the payment until covered: wallet gets a
   * `REVERSAL` credit, the auto-paid bill's `paid_amount` drops and its status is
   * recomputed (a soft-deleted bill keeps its status). Runs under the wallet locks
   * already held. Throws the old 409 if the debits cannot cover the shortfall.
   *
   * Debits are undone whole, so the last one may overshoot the shortfall (shortfall
   * 100, debit 200 -> 200 returns to the wallet and the bill is fully re-opened).
   * That is deliberate: a bill is never left half re-opened.
   */
  private async undoGenerationDebits(
    manager: EntityManager,
    payment: Payment,
    shortfalls: Map<string, number>,
    lockedBills: Set<string>,
    tenantId: string,
    actorUserId: string,
  ): Promise<{ reopened_bill_ids: string[]; undone_generation_debits: UndoneDebitAudit[] }> {
    const out = {
      reopened_bill_ids: [] as string[],
      undone_generation_debits: [] as UndoneDebitAudit[],
    };
    const feeRepo = manager.getRepository(StudentFee);
    for (const [studentId, shortfall] of [...shortfalls].sort(([a], [b]) => (a < b ? -1 : 1))) {
      const wallet = await this.walletService.getOrCreate(studentId, tenantId, manager, true);
      const debits = await this.liveGenerationDebits(
        manager,
        [wallet.id],
        tenantId,
        payment.created_at,
      );

      let covered = 0;
      const picked: WalletTransaction[] = [];
      for (const d of debits) {
        if (toPaisa(covered) >= toPaisa(shortfall)) break;
        picked.push(d);
        covered = round2(covered + Math.abs(Number(d.amount)));
      }
      if (toPaisa(covered) < toPaisa(shortfall)) {
        throw new ConflictException({
          code: 'REVERSE_BLOCKED_BY_NON_PAYMENT_WALLET_SPEND',
          message: `Reversing this payment would take the wallet balance negative, and the wallet debits made by fee generation cannot cover the shortfall — reversal must be handled manually.`,
        });
      }
      // A debit appeared (or its bill changed) after the bills were locked.
      if (picked.some((d) => d.student_fee_id && !lockedBills.has(d.student_fee_id))) {
        throw new ConflictException({
          code: 'REVERSE_RETRY',
          message: 'Wallet activity changed while reversing — please retry.',
        });
      }

      for (const debit of picked) {
        const amount = Math.abs(Number(debit.amount));
        await this.walletService.credit(
          {
            studentId,
            tenantId,
            amount,
            kind: WalletTransactionKind.REVERSAL,
            studentFeeId: debit.student_fee_id,
            reversalOfId: debit.id,
            createdByUserId: actorUserId,
            note: `Undo fee-generation wallet spend to reverse payment ${payment.id}`,
            allowDeletedStudent: true,
          },
          manager,
        );
        const entry: UndoneDebitAudit = {
          debit_id: debit.id,
          amount,
          student_fee_id: debit.student_fee_id,
        };
        const bill = debit.student_fee_id
          ? await feeRepo
              .createQueryBuilder('sf')
              .withDeleted()
              .where('sf.id = :id', { id: debit.student_fee_id })
              .andWhere(
                'sf.student_id IN (SELECT s.id FROM students s WHERE s.tenant_id = :tenantId)',
                { tenantId },
              )
              .getOne()
          : null;
        if (bill) {
          const newPaid = round2(Math.max(0, Number(bill.paid_amount) - amount));
          const remaining = round2(
            Number(bill.total_amount) - newPaid - Number(bill.discount_amount),
          );
          const status = bill.deleted_at
            ? bill.status
            : toPaisa(remaining) <= 0
              ? FeeStatus.PAID
              : toPaisa(newPaid) > 0
                ? FeeStatus.PARTIALLY_PAID
                : FeeStatus.PENDING;
          await feeRepo.update(bill.id, { paid_amount: newPaid, status });
          Object.assign(entry, {
            paid_amount_before: Number(bill.paid_amount),
            paid_amount_after: newPaid,
            status_before: bill.status,
            status_after: status,
          });
          // Only a bill whose status really changed is "reopened"; the full detail is in
          // undone_generation_debits either way.
          if (status !== bill.status) out.reopened_bill_ids.push(bill.id);
        }
        out.undone_generation_debits.push(entry);
      }
    }
    return out;
  }

  /** Which student owns each wallet a removed-bill credit sits in. */
  private async walletOwners(
    manager: EntityManager,
    credits: WalletTransaction[],
  ): Promise<Map<string, string>> {
    if (credits.length === 0) return new Map();
    const wallets = await manager
      .getRepository(StudentWallet)
      .find({ where: { id: In([...new Set(credits.map((c) => c.wallet_id))]) } });
    return new Map(wallets.map((w) => [w.id, w.student_id]));
  }

  /**
   * D10 per wallet: the payer's wallet (change added) plus every wallet that got a
   * removed-bill credit. Inside a transaction the wallets are locked first, in
   * sorted student-id order (after the bills), then each is checked against its
   * locked balance. Outside one it is the cheap unlocked pre-check.
   */
  private async assertAllWalletsInOrder(
    payment: Payment,
    credits: WalletTransaction[],
    manager?: EntityManager,
    owners?: Map<string, string>,
    tenantId?: string,
  ): Promise<Map<string, number>> {
    const ownerOf = owners ?? (await this.walletOwners(this.paymentRepo.manager, credits));
    // Only wallets this payment put money into: a plain cash payment locks
    // (or creates) no wallet at all.
    const added = new Map<string, number>();
    if (Number(payment.wallet_credit_added) > 0) {
      added.set(payment.student_id, Number(payment.wallet_credit_added));
    }
    for (const c of credits) {
      const sid = ownerOf.get(c.wallet_id)!;
      added.set(sid, round2((added.get(sid) ?? 0) + Number(c.amount)));
    }
    const shortfalls = new Map<string, number>();
    for (const sid of [...added.keys()].sort()) {
      // allowDeleted: unwinding money must work for a student who has left.
      const balance = manager
        ? Number((await this.walletService.getOrCreate(sid, tenantId!, manager, true)).balance)
        : await this.walletService.balance(sid, payment.tenant_id);
      const short = await this.assertReverseInOrder(
        payment,
        sid,
        added.get(sid)!,
        balance,
        manager,
      );
      if (short > 0) shortfalls.set(sid, short);
    }
    return shortfalls;
  }

  /** Live `CREDIT_BILL_REMOVED` wallet credits made for `paymentId` (bill removed
   * after payment, MON-03) that no `REVERSAL` row has taken back yet. */
  private async removedBillCredits(
    manager: EntityManager,
    paymentId: string,
  ): Promise<WalletTransaction[]> {
    const repo = manager.getRepository(WalletTransaction);
    const credits = await repo.find({
      where: { payment_id: paymentId, kind: WalletTransactionKind.CREDIT_BILL_REMOVED },
    });
    if (credits.length === 0) return [];
    const taken = new Set(
      (await repo.find({ where: { reversal_of_id: In(credits.map((c) => c.id)) } })).map(
        (r) => r.reversal_of_id,
      ),
    );
    return credits.filter((c) => !taken.has(c.id));
  }
}
