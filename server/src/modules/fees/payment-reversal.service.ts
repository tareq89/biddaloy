import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import {
  AuditAction,
  ApprovalScope,
  FeeStatus,
  PaymentStatus,
  WalletTransactionKind,
} from '@biddaloy/shared';
import { Payment } from './entities/payment.entity';
import { PaymentAllocation } from './entities/payment-allocation.entity';
import { StudentFee } from './entities/student-fee.entity';
import { WalletService } from './wallet.service';
import { AuditService } from '../audit/audit.service';
import { InvoicesService } from '../invoices/invoices.service';
import { checkoutEvents } from './checkout.service';

const AMOUNT_EPSILON = 0.01;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
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
 * and `PaymentAllocationService` established for the forward flow, just
 * run backwards.
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
      throw new NotFoundException(`Payment with ID "${paymentId}" not found`);
    }
    this.assertReversible(payment);

    // A cheap pre-check outside the transaction — cuts an obviously
    // doomed request off before it pays for a transaction and a wallet
    // lock. It is NOT the real guard: see the re-check under the wallet
    // row lock below, which is what actually prevents the race.
    if (Number(payment.wallet_credit_added) > 0) {
      await this.assertReverseInOrder(payment);
    }

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
        throw new NotFoundException(`Payment with ID "${paymentId}" not found`);
      }
      this.assertReversible(locked);

      // Lock every bill this payment allocated against BEFORE the wallet
      // lock below — `CheckoutService` locks bills (`ORDER BY sf.id ASC`)
      // then the wallet (`WalletService.getOrCreate`), so taking these in
      // the opposite order here would be a classic ABBA lock inversion: a
      // concurrent checkout and reversal on the same student could each
      // hold one lock and wait on the other, a Postgres 40P01 deadlock.
      // Same deterministic `sf.id ASC` order as `CheckoutService` to also
      // avoid deadlocking two reversals racing each other. `withDeleted`
      // because a bill can have been soft-deleted since this payment was
      // recorded — its paid_amount still needs unwinding even though it's
      // gone.
      const feeIds = payment.allocations.map((a) => a.student_fee_id);
      const lockedBills =
        feeIds.length > 0
          ? await studentFeeRepo
              .createQueryBuilder('sf')
              .withDeleted()
              .where('sf.id IN (:...ids)', { ids: feeIds })
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
      if (Number(locked.wallet_credit_added) > 0) {
        const wallet = await this.walletService.getOrCreate(locked.student_id, tenantId, manager);
        await this.assertReverseInOrder(locked, Number(wallet.balance), manager);
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
        const statusBefore = bill.status;
        let statusAfter = bill.status;
        if (!bill.deleted_at) {
          const remaining = round2(Number(bill.total_amount) - newPaid - newDiscount);
          statusAfter =
            remaining <= AMOUNT_EPSILON
              ? FeeStatus.PAID
              : newPaid > AMOUNT_EPSILON
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
          paid_amount_before: Number(bill.paid_amount),
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
      // NotFoundException is the actual signal.
      if (payment.invoice_id) {
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
            wallet_withdrawn: walletCreditAdded,
            wallet_refunded: walletCreditUsed,
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

    checkoutEvents.emit('payments.reversed', {
      payment_id: payment.id,
      reversal_payment_id: reversalPayment.id,
      tenant_id: tenantId,
      student_id: payment.student_id,
    });

    return reversalPayment;
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
        message: `Payment "${payment.id}" was already reversed`,
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
        message: `Payment "${payment.id}" has status "${payment.payment_status}" — only a SUCCESS payment can be reversed`,
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
    currentBalance?: number,
    manager?: EntityManager,
  ): Promise<void> {
    const balance =
      currentBalance ?? (await this.walletService.balance(payment.student_id, payment.tenant_id));
    const creditAdded = round2(Number(payment.wallet_credit_added));
    const balanceAfterRemoval = round2(balance - creditAdded);
    if (balanceAfterRemoval >= -AMOUNT_EPSILON) return;

    const shortfall = round2(-balanceAfterRemoval);
    const paymentRepo = manager ? manager.getRepository(Payment) : this.paymentRepo;
    // Same order the "later than `payment`" cutoff below relies on: ties
    // break on `created_at ASC` (actual insertion order — `id` is a random
    // uuid and tells you nothing about when a row was written), so a
    // payment is "later" exactly when it sits after `payment`'s own
    // position in this list, not when `payment_date` alone is strictly
    // greater, which would wrongly skip a same-timestamp payment recorded
    // after it.
    const ordered = await paymentRepo.find({
      where: {
        tenant_id: payment.tenant_id,
        student_id: payment.student_id,
      },
      order: { payment_date: 'ASC', created_at: 'ASC' },
    });
    const paymentIndex = ordered.findIndex((p) => p.id === payment.id);
    const laterSpenders = paymentIndex === -1 ? ordered : ordered.slice(paymentIndex + 1);

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
      if (covered >= shortfall - AMOUNT_EPSILON) break;
    }

    if (blockingIds.length === 0) {
      // The shortfall is real (checked above) but no *payment* spent the
      // wallet credit this one added — e.g. `FeeGenerationService` auto-
      // debiting the wallet against a newly generated bill
      // (`WalletTransactionKind.DEBIT_GENERATION`), not a payment at all.
      // `payment_ids: []` here would tell the caller to "reverse the
      // later payments first" while naming none, an un-actionable dead
      // end — surface that plainly instead.
      throw new ConflictException({
        code: 'REVERSE_BLOCKED_BY_NON_PAYMENT_WALLET_SPEND',
        message: `Reversing this payment would take the wallet balance negative, but no later payment (only a non-payment wallet debit, e.g. fee generation) is responsible — reversal must be handled manually.`,
      });
    }

    throw new ReverseLaterPaymentsFirstException(blockingIds);
  }
}
