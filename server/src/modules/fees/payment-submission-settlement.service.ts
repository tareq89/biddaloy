import { createHash } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In } from 'typeorm';
import {
  PaymentMethod,
  PaymentSubmissionSource,
  PaymentSubmissionStatus,
  WalletTransactionKind,
} from '@biddaloy/shared';
import { toPaisa } from '../../common/constants/money';
import { PaymentSubmission } from '../payment-submissions/entities/payment-submission.entity';
import { PaymentSubmissionBill } from '../payment-submissions/entities/payment-submission-bill.entity';
import { PaymentSubmissionEvent } from '../payment-submissions/entities/payment-submission-event.entity';
import { Payment } from './entities/payment.entity';
import { StudentFee } from './entities/student-fee.entity';
import { CheckoutService } from './checkout.service';
import { WalletService } from './wallet.service';
import { OPEN_FEE_STATUSES } from './fees.constants';
import { CheckoutDto } from './dto/checkout.dto';

export type SettlementMode = 'PROOF_STRICT' | 'ONLINE_LENIENT';

export interface SettlementResult {
  outcome: 'SETTLED' | 'DISCARDED';
  paymentIds: string[];
  /** Online money that no bill could take (it went to the wallet). */
  unmatched: boolean;
  /** The submission was already settled; nothing was written this call. */
  alreadySettled: boolean;
}

const NOT_FOUND = 'Payment submission not found';
const DISCARD_PAID = 'BILL_ALREADY_PAID';
const DISCARD_CHANGED = 'BALANCE_CHANGED';
const DISCARD_REMOVED = 'BILL_REMOVED';

/**
 * One key per (submission, student), shaped like a UUID so it fits `payments.idempotency_key`
 * (varchar 64). The same inputs always give the same key, so a retry finds the first run's payment.
 */
export function settlementIdempotencyKey(submissionId: string, studentId: string): string {
  const h = createHash('sha256').update(`${submissionId}:${studentId}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function errorCode(err: unknown): string | undefined {
  if (!(err instanceof HttpException)) return undefined;
  const body = err.getResponse() as { details?: { code?: string } };
  return body?.details?.code;
}

/** A checkout lost a race for the bill balance (a counter payment landed in between). */
function isBalanceRace(err: unknown): boolean {
  const code = errorCode(err);
  return code === 'CHECKOUT_FEE_SETTLED' || code === 'CHECKOUT_AMOUNT_EXCEEDS_BALANCE';
}

const SETTLEABLE: Record<PaymentSubmissionSource, PaymentSubmissionStatus[]> = {
  [PaymentSubmissionSource.PROOF]: [
    PaymentSubmissionStatus.PENDING,
    PaymentSubmissionStatus.REJECTED,
  ],
  [PaymentSubmissionSource.ONLINE]: [
    PaymentSubmissionStatus.PENDING,
    PaymentSubmissionStatus.CANCELLED,
    PaymentSubmissionStatus.EXPIRED,
  ],
};

const DONE: PaymentSubmissionStatus[] = [
  PaymentSubmissionStatus.CONFIRMED,
  PaymentSubmissionStatus.COMPLETED,
  PaymentSubmissionStatus.REVERSED,
];

/**
 * [3.x] Turns one guardian submission into one Payment + Invoice per student, through the
 * existing checkout (D4, D39). Only the submission row is locked here: checkout locks the
 * bills on its own connection, so locking them here too would deadlock. Each checkout commits
 * on its own, so a crash midway is repaired by running `settle` again: the deterministic
 * idempotency key finds the payments already made and only the rest are created.
 */
@Injectable()
export class PaymentSubmissionSettlement {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly checkoutService: CheckoutService,
    private readonly walletService: WalletService,
  ) {}

  async settle(
    submissionId: string,
    tenantId: string,
    actorUserId: string,
    mode: SettlementMode,
  ): Promise<SettlementResult> {
    // ponytail: this outer tx holds one pool connection while checkout uses another, so
    // concurrent settles are capped by the pool size; upgrade = limit settle concurrency.
    return this.dataSource.transaction(async (manager) => {
      const sub = await manager
        .getRepository(PaymentSubmission)
        .createQueryBuilder('s')
        .where('s.id = :submissionId AND s.tenant_id = :tenantId', { submissionId, tenantId })
        .setLock('pessimistic_write')
        .getOne();
      if (!sub) throw new NotFoundException(NOT_FOUND);

      const wantSource =
        mode === 'PROOF_STRICT' ? PaymentSubmissionSource.PROOF : PaymentSubmissionSource.ONLINE;
      if (sub.source !== wantSource) {
        throw new BadRequestException('This payment cannot be settled this way');
      }

      const subBills = await manager.getRepository(PaymentSubmissionBill).find({
        where: { submission_id: sub.id, tenant_id: tenantId },
        order: { student_id: 'ASC', student_fee_id: 'ASC' },
      });

      if (DONE.includes(sub.status)) {
        const ids = [...new Set(subBills.flatMap((b) => (b.payment_id ? [b.payment_id] : [])))];
        return {
          outcome: 'SETTLED',
          paymentIds: ids,
          unmatched: sub.unmatched,
          alreadySettled: true,
        };
      }
      if (sub.status === PaymentSubmissionStatus.DISCARDED) {
        return { outcome: 'DISCARDED', paymentIds: [], unmatched: false, alreadySettled: false };
      }
      if (!SETTLEABLE[sub.source].includes(sub.status)) {
        throw new ConflictException('This payment cannot be settled in its current state');
      }

      if (subBills.length === 0) {
        throw new BadRequestException('This payment has no bills');
      }
      const startPaisa = subBills.reduce((n, b) => n + toPaisa(b.amount_at_start), 0);
      if (startPaisa !== toPaisa(sub.amount)) {
        throw new BadRequestException('The payment amount does not match its bills');
      }

      const byStudent = new Map<string, PaymentSubmissionBill[]>();
      for (const b of subBills) {
        byStudent.set(b.student_id, [...(byStudent.get(b.student_id) ?? []), b]);
      }
      const studentIds = [...byStudent.keys()].sort();

      // Payments a crashed earlier run already made.
      const existing = await manager.getRepository(Payment).find({
        where: {
          tenant_id: tenantId,
          idempotency_key: In(studentIds.map((s) => settlementIdempotencyKey(sub.id, s))),
        },
      });
      const paymentByStudent = new Map<string, Payment>();
      for (const s of studentIds) {
        const p = existing.find((e) => e.idempotency_key === settlementIdempotencyKey(sub.id, s));
        if (p) paymentByStudent.set(s, p);
      }

      const ctx: Ctx = {
        manager,
        sub,
        tenantId,
        actorUserId,
        byStudent,
        studentIds,
        paymentByStudent,
      };
      return mode === 'PROOF_STRICT' ? this.strict(ctx) : this.lenient(ctx);
    });
  }

  // ---------------------------------------------------------------- strict (proof)

  private async strict(ctx: Ctx): Promise<SettlementResult> {
    const { manager, sub, tenantId, byStudent, studentIds, paymentByStudent } = ctx;
    const todo = studentIds.filter((s) => !paymentByStudent.has(s));

    // Never discard once any payment of this submission exists (a crashed earlier run): the
    // money is already booked, so only finishing the rest is safe.
    if (todo.length > 0 && paymentByStudent.size === 0) {
      const live = await this.loadBills(
        manager,
        tenantId,
        todo.flatMap((s) => byStudent.get(s)!),
      );
      for (const sb of todo.flatMap((s) => byStudent.get(s)!)) {
        const balance = this.openBalance(live.get(sb.student_fee_id));
        if (!live.has(sb.student_fee_id)) return this.discard(ctx, DISCARD_REMOVED);
        if (balance === null) return this.discard(ctx, DISCARD_PAID);
        if (balance !== toPaisa(sb.amount_at_start)) return this.discard(ctx, DISCARD_CHANGED);
      }
    }

    for (const s of todo) {
      const lines = byStudent.get(s)!.map((b) => ({
        student_fee_id: b.student_fee_id,
        amount: toPaisa(b.amount_at_start) / 100,
      }));
      try {
        const res = await this.checkout(
          ctx,
          s,
          lines,
          sub.method as PaymentMethod,
          sub.reference_normalised,
        );
        paymentByStudent.set(s, res);
      } catch (err) {
        // Lost a race with a counter payment. Nothing paid yet: discard cleanly (D26: never wallet).
        // Else an earlier student's payment is already committed: leave it for a retry to finish.
        if (isBalanceRace(err)) {
          if (paymentByStudent.size === 0) return this.discard(ctx, DISCARD_CHANGED);
          // Part of the submission is already paid: neither discard nor wallet. Staff finish it by hand.
          throw new ConflictException({
            message: 'This payment was only partly settled and needs manual handling',
            details: { code: 'SETTLEMENT_PARTIAL' },
          });
        }
        throw err;
      }
    }

    await this.finish(ctx, PaymentSubmissionStatus.CONFIRMED, false, null);
    return {
      outcome: 'SETTLED',
      paymentIds: studentIds.map((s) => paymentByStudent.get(s)!.id),
      unmatched: false,
      alreadySettled: false,
    };
  }

  // ---------------------------------------------------------------- lenient (online)

  private async lenient(ctx: Ctx): Promise<SettlementResult> {
    const { manager, sub, tenantId, actorUserId, byStudent, studentIds, paymentByStudent } = ctx;
    // BKASH is the only PaymentGatewayProvider today; adding a provider to that enum must add
    // its PaymentMethod mapping here (sub.provider -> method).
    const method = PaymentMethod.BKASH;
    let unmatched = false;

    for (const s of studentIds) {
      const mine = byStudent.get(s)!;
      const startPaisa = mine.reduce((n, b) => n + toPaisa(b.amount_at_start), 0);
      let payment = paymentByStudent.get(s) ?? null;
      let appliedPaisa = 0;

      if (payment) {
        appliedPaisa = toPaisa(payment.total_amount);
      } else {
        for (let attempt = 0; attempt < 2 && !payment; attempt++) {
          const live = await this.loadBills(manager, tenantId, mine);
          const lines = mine.flatMap((b) => {
            const bal = this.openBalance(live.get(b.student_fee_id));
            const applied = bal === null ? 0 : Math.min(toPaisa(b.amount_at_start), bal);
            return applied > 0 ? [{ student_fee_id: b.student_fee_id, amount: applied / 100 }] : [];
          });
          appliedPaisa = lines.reduce((n, l) => n + toPaisa(l.amount), 0);
          if (lines.length === 0) break;
          try {
            payment = await this.checkout(ctx, s, lines, method, sub.provider_trx_id);
            paymentByStudent.set(s, payment);
          } catch (err) {
            // A counter payment landed after the read: recompute once, then give up loudly.
            if (!isBalanceRace(err) || attempt === 1) throw err;
          }
        }
        if (!payment) appliedPaisa = 0;
      }

      const remainder = startPaisa - appliedPaisa;
      if (remainder > 0) {
        unmatched = true;
        await this.walletService.credit(
          {
            studentId: s,
            tenantId,
            amount: remainder / 100,
            kind: WalletTransactionKind.CREDIT_OVERPAYMENT,
            paymentId: payment?.id ?? null,
            createdByUserId: actorUserId,
            allowDeletedStudent: true,
          },
          manager,
        );
      }
    }

    await this.finish(
      ctx,
      PaymentSubmissionStatus.COMPLETED,
      unmatched,
      unmatched ? 'UNMATCHED' : null,
    );
    return {
      outcome: 'SETTLED',
      paymentIds: studentIds.flatMap((s) => {
        const p = paymentByStudent.get(s);
        return p ? [p.id] : [];
      }),
      unmatched,
      alreadySettled: false,
    };
  }

  // ---------------------------------------------------------------- helpers

  /** Live (not soft-deleted) bills of this tenant with a live student; others are absent. */
  private async loadBills(
    manager: EntityManager,
    tenantId: string,
    subBills: PaymentSubmissionBill[],
  ): Promise<Map<string, StudentFee>> {
    const rows = await manager.getRepository(StudentFee).find({
      where: { id: In(subBills.map((b) => b.student_fee_id)) },
      relations: ['student'],
    });
    return new Map(
      rows
        .filter((b) => b.student && b.student.tenant_id === tenantId && !b.student.deleted_at)
        .map((b) => [b.id, b]),
    );
  }

  /** Balance in paisa when the bill is still open with money owed, else null. */
  private openBalance(bill: StudentFee | undefined): number | null {
    if (!bill || !OPEN_FEE_STATUSES.includes(bill.status)) return null;
    const bal =
      toPaisa(bill.total_amount) - toPaisa(bill.discount_amount) - toPaisa(bill.paid_amount);
    return bal > 0 ? bal : null;
  }

  private async checkout(
    ctx: Ctx,
    studentId: string,
    lines: { student_fee_id: string; amount: number }[],
    method: PaymentMethod,
    reference: string | null,
  ): Promise<Payment> {
    const { sub, tenantId, actorUserId } = ctx;
    const dto = {
      idempotency_key: settlementIdempotencyKey(sub.id, studentId),
      lines: lines.map((l) => ({ ...l, one_off_discount: 0 })),
      payment_method: method,
      transaction_reference: reference ?? undefined,
      change_handling: 'RETURN',
    } as CheckoutDto;
    const res = await this.checkoutService.checkout(
      dto,
      tenantId,
      actorUserId,
      { headers: {}, currentTenant: { id: tenantId }, user: { sub: actorUserId } },
      undefined,
      { receivedByUserId: null },
    );
    return res.payment;
  }

  private async discard(ctx: Ctx, code: string): Promise<SettlementResult> {
    const { manager, sub, tenantId, actorUserId } = ctx;
    await manager
      .getRepository(PaymentSubmission)
      .update(
        { id: sub.id, tenant_id: tenantId },
        { status: PaymentSubmissionStatus.DISCARDED, discard_reason: code },
      );
    await this.event(ctx, PaymentSubmissionStatus.DISCARDED, code, actorUserId);
    return { outcome: 'DISCARDED', paymentIds: [], unmatched: false, alreadySettled: false };
  }

  private async finish(
    ctx: Ctx,
    to: PaymentSubmissionStatus,
    unmatched: boolean,
    reason: string | null,
  ): Promise<void> {
    const { manager, sub, tenantId, actorUserId, studentIds, paymentByStudent } = ctx;
    for (const s of studentIds) {
      const p = paymentByStudent.get(s);
      if (!p) continue;
      await manager
        .getRepository(PaymentSubmissionBill)
        .update(
          { submission_id: sub.id, tenant_id: tenantId, student_id: s },
          { payment_id: p.id },
        );
    }
    const now = new Date();
    await manager.getRepository(PaymentSubmission).update(
      { id: sub.id, tenant_id: tenantId },
      {
        status: to,
        settled_at: now,
        unmatched,
        ...(to === PaymentSubmissionStatus.CONFIRMED
          ? { decided_by_user_id: actorUserId, decided_at: now }
          : {}),
      },
    );
    await this.event(ctx, to, reason, actorUserId);
  }

  private async event(
    ctx: Ctx,
    to: PaymentSubmissionStatus,
    reason: string | null,
    actorUserId: string,
  ): Promise<void> {
    const { manager, sub, tenantId } = ctx;
    // Append-only table: insert, never save/update.
    await manager.getRepository(PaymentSubmissionEvent).insert({
      tenant_id: tenantId,
      submission_id: sub.id,
      from_status: sub.status,
      to_status: to,
      actor_user_id: actorUserId,
      reason_code: reason,
    });
  }
}

interface Ctx {
  manager: EntityManager;
  sub: PaymentSubmission;
  tenantId: string;
  actorUserId: string;
  byStudent: Map<string, PaymentSubmissionBill[]>;
  studentIds: string[];
  paymentByStudent: Map<string, Payment>;
}
