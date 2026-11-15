import { randomUUID } from 'crypto';
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import {
  AuditAction,
  FeeStatus,
  PaymentGatewayEnvironment,
  PaymentGatewayProvider as GatewayKind,
  PaymentSubmissionSource,
  PaymentSubmissionStatus,
} from '@biddaloy/shared';
import { toPaisa } from '../../common/constants/money';
import { resolveAppBaseUrl } from '../account-access/app-base-url.util';
import { AuditService } from '../audit/audit.service';
import { PaymentSubmissionSettlement } from '../fees/payment-submission-settlement.service';
import { bdtToPaisa } from '../payment-gateways/bkash/bkash.client';
import { GatewayCreds, GatewayPayment } from '../payment-gateways/payment-gateway.provider';
import { PaymentGatewayRegistry } from '../payment-gateways/payment-gateway.registry';
import { TenantSettingsCache } from '../schools/settings/tenant-settings-cache.service';
import { SchoolsService } from '../schools/schools.service';
import { FamilyAccessService } from '../students/family-access.service';
import {
  OnlinePaymentResultDto,
  StartOnlinePaymentDto,
  StartOnlinePaymentResponseDto,
} from './dto/online-payment.dto';
import {
  PAYMENT_SUBMISSION_EVENTS,
  PaymentSubmissionEventPayload,
  paymentSubmissionEvents,
} from './payment-submission.events';
import { ProofCaller, ProofSubmissionsService } from './proof-submissions.service';

/** Rule 23: one fixed sentence per failure, never the submitted value or a credential. */
const MSG = {
  disabled: 'Online payment is not available',
  billNotFound: 'Bill not found',
  billBusy: 'A selected bill cannot take a payment right now',
  gateway: 'Online payment is not available right now',
  notFound: 'Payment not found',
  badQuery: 'Invalid callback',
  credsMissing: 'bKash credentials are not complete',
  testFailed: 'bKash did not accept these credentials',
} as const;

/** A payment waits this long for the guardian before the sweep may expire it (D24). */
export const ONLINE_PAYMENT_TTL_MIN = 30;
const DONE_STATES: PaymentSubmissionStatus[] = [
  PaymentSubmissionStatus.COMPLETED,
  PaymentSubmissionStatus.CONFIRMED,
  PaymentSubmissionStatus.REVERSED,
  PaymentSubmissionStatus.FAILED,
  PaymentSubmissionStatus.DISCARDED,
];
const PAYMENT_ID_SHAPE = /^[A-Za-z0-9_-]{1,64}$/;

interface BillRow {
  id: string;
  student_id: string;
  balance: string;
  status: FeeStatus;
}

interface SubRow {
  id: string;
  tenant_id: string;
  status: PaymentSubmissionStatus;
  amount: string;
  environment: PaymentGatewayEnvironment | null;
  submitted_by_user_id: string;
}

type CallbackStatus = 'success' | 'cancel' | 'failure';

/**
 * [3.x/#3984] Guardian bKash payment: start, the browser callback, the result read and the admin
 * test-connection. The callback URL is untrusted input that only names a paymentID; money is
 * booked only when bKash itself answers `Completed` for that paymentID, with the same amount and
 * with our submission id as its invoice number (Rule 19). All outbound calls go through
 * BkashClient (Rule 7) with the school's own creds, which are never logged or returned.
 */
@Injectable()
export class OnlinePaymentsService {
  private readonly logger = new Logger(OnlinePaymentsService.name);

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly config: ConfigService,
    private readonly schools: SchoolsService,
    private readonly settingsCache: TenantSettingsCache,
    private readonly familyAccess: FamilyAccessService,
    private readonly proofs: ProofSubmissionsService,
    private readonly settlement: PaymentSubmissionSettlement,
    private readonly gateways: PaymentGatewayRegistry,
    private readonly audit: AuditService,
  ) {}

  private get bkash() {
    return this.gateways.get(GatewayKind.BKASH);
  }

  /** The school's own bKash credentials, or null while any of the five fields is missing. */
  private async credsOf(tenantId: string): Promise<GatewayCreds | null> {
    // Decrypted: the secret fields are plain strings here (typed loosely by the masking helper).
    const b = (await this.schools.getDecryptedSettings(tenantId)).payments?.bkash as
      | Partial<Record<'environment' | 'appKey' | 'appSecret' | 'username' | 'password', string>>
      | undefined;
    if (!b?.environment || !b.appKey || !b.appSecret || !b.username || !b.password) return null;
    return {
      environment: b.environment,
      appKey: b.appKey,
      appSecret: b.appSecret,
      username: b.username,
      password: b.password,
      tenantId,
    };
  }

  // ------------------------------------------------------------------ start

  async start(
    dto: StartOnlinePaymentDto,
    ctx: ProofCaller,
  ): Promise<StartOnlinePaymentResponseDto> {
    const onlineEnabled = (await this.schools.getResolvedSettings(ctx.tenantId)).payments
      ?.onlineEnabled;
    const creds = onlineEnabled ? await this.credsOf(ctx.tenantId) : null;
    if (!creds) throw new BadRequestException(MSG.disabled);

    const billIds = [...new Set(dto.billIds)];
    const linked = new Set(
      await this.familyAccess.getLinkedStudentIds(ctx.role, ctx.userId, ctx.tenantId),
    );
    const submissionId = randomUUID();
    let totalPaisa = 0;

    await this.ds.transaction(async (m) => {
      // Tenant comes from the student: student_fees has no tenant column. Locked in id order.
      const bills: BillRow[] = await m.query(
        `SELECT sf.id, sf.student_id, sf.status,
                (sf.total_amount - sf.discount_amount - sf.paid_amount)::text AS balance
           FROM student_fees sf
           JOIN students s ON s.id = sf.student_id AND s.tenant_id = $1 AND s.deleted_at IS NULL
          WHERE sf.id = ANY($2::uuid[]) AND sf.deleted_at IS NULL
          ORDER BY sf.id FOR UPDATE OF sf`,
        [ctx.tenantId, billIds],
      );
      // Missing, other tenant, other family or a left student: the same 404.
      if (bills.length !== billIds.length || bills.some((b) => !linked.has(b.student_id))) {
        throw new NotFoundException(MSG.billNotFound);
      }
      const open = (b: BillRow) =>
        b.status !== FeeStatus.PAID && b.status !== FeeStatus.WAIVED && toPaisa(b.balance) > 0;
      // D24: a PENDING submission of either source holds the bill.
      const busy = await this.proofs.billsWithLiveSubmission(m, ctx.tenantId, billIds);
      if (!bills.every(open) || busy.length > 0) throw new ConflictException(MSG.billBusy);

      totalPaisa = bills.reduce((s, b) => s + toPaisa(b.balance), 0);
      await m.query(
        `INSERT INTO payment_submissions
           (id, tenant_id, source, status, submitted_by_user_id, amount, provider, environment,
            started_at, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(), NOW() + make_interval(mins => $9))`,
        [
          submissionId,
          ctx.tenantId,
          PaymentSubmissionSource.ONLINE,
          PaymentSubmissionStatus.PENDING,
          ctx.userId,
          (totalPaisa / 100).toFixed(2),
          GatewayKind.BKASH,
          creds.environment,
          ONLINE_PAYMENT_TTL_MIN,
        ],
      );
      for (const b of bills) {
        await m.query(
          `INSERT INTO payment_submission_bills
             (tenant_id, submission_id, student_fee_id, student_id, amount_at_start)
           VALUES ($1,$2,$3,$4,$5)`,
          [ctx.tenantId, submissionId, b.id, b.student_id, b.balance],
        );
      }
      await this.event(m, ctx.tenantId, submissionId, null, 'PENDING', ctx.userId, null);
      await this.audit.record(
        {
          action: AuditAction.CREATE,
          entity_type: 'PaymentSubmission',
          entity_id: submissionId,
          tenant_id: ctx.tenantId,
          performed_by_user_id: ctx.userId,
          new_values: { source: 'ONLINE', bills: bills.length },
        },
        m,
      );
    });
    this.emit(PAYMENT_SUBMISSION_EVENTS.SUBMITTED, ctx.tenantId, submissionId, ctx.userId);

    // Outside the transaction: no row lock is held across a network call.
    let created: GatewayPayment | undefined;
    try {
      created = await this.bkash.create(
        {
          amountPaisa: totalPaisa,
          orderId: submissionId,
          callbackUrl: `${resolveAppBaseUrl(this.config)}/api/v1/online-payments/callback`,
          payerReference: ctx.userId,
        },
        creds,
      );
    } catch (err) {
      this.logger.error(`bKash create failed for submission ${submissionId}: ${errText(err)}`);
    }
    if (created?.statusCode !== '0000' || !created.paymentID || !created.bkashURL) {
      if (created) {
        this.logger.error(`bKash create refused for ${submissionId}: code ${created.statusCode}`);
      }
      await this.closeIfPending(ctx.tenantId, submissionId, 'FAILED', 'GATEWAY_CREATE', ctx.userId);
      throw new ServiceUnavailableException(MSG.gateway);
    }
    try {
      await this.ds.query(
        `UPDATE payment_submissions SET provider_payment_id = $1, updated_at = NOW()
          WHERE id = $2 AND tenant_id = $3`,
        [created.paymentID, submissionId, ctx.tenantId],
      );
    } catch (err) {
      // No stored paymentID means a callback could never match it: do not hand out the URL.
      this.logger.error(`bKash paymentID not saved for ${submissionId}: ${errText(err)}`);
      await this.closeIfPending(ctx.tenantId, submissionId, 'FAILED', 'PERSIST', ctx.userId);
      throw new ServiceUnavailableException(MSG.gateway);
    }
    return { id: submissionId, bkashUrl: created.bkashURL };
  }

  // --------------------------------------------------------------- callback

  /** Where the browser lands. `id` is ours (a UUID we made), never taken from the URL. */
  resultUrl(id?: string): string {
    return `${resolveAppBaseUrl(this.config)}/portal/fees/pay/result${id ? `?id=${id}` : ''}`;
  }

  /**
   * The URL only names a paymentID. Order: shape check, find OUR submission by it (no bKash call
   * otherwise), then bKash confirms. A bKash error never marks the row failed (the money may
   * have moved): it stays PENDING for a replay. Returns the submission id to show, or undefined.
   */
  async handleCallback(paymentID: unknown, status: unknown): Promise<string | undefined> {
    if (typeof paymentID !== 'string' || !PAYMENT_ID_SHAPE.test(paymentID)) {
      throw new BadRequestException(MSG.badQuery);
    }
    const seen: CallbackStatus =
      status === 'success' ? 'success' : status === 'cancel' ? 'cancel' : 'failure';
    const subs: SubRow[] = await this.ds.query(
      `SELECT id, tenant_id, status, amount::text AS amount, environment, submitted_by_user_id
         FROM payment_submissions
        WHERE provider = 'BKASH' AND source = 'ONLINE' AND provider_payment_id = $1 LIMIT 2`,
      [paymentID],
    );
    if (subs.length !== 1) {
      if (subs.length > 1)
        this.logger.error('bKash callback paymentID matches several submissions');
      return undefined;
    }
    const sub = subs[0];
    // A replay after a final outcome shows the result and calls nothing. CANCELLED and EXPIRED are
    // not final: the guardian may pay after the sweep, so bKash is asked and settle accepts them.
    if (DONE_STATES.includes(sub.status)) return sub.id;

    const creds = await this.credsOf(sub.tenant_id);
    if (!creds || creds.environment !== sub.environment) {
      this.logger.error(`bKash callback: credentials unusable for submission ${sub.id}`);
      return sub.id;
    }

    let known: GatewayPayment;
    try {
      known = await this.confirm(paymentID, seen, creds);
    } catch (err) {
      this.logger.error(`bKash callback could not confirm ${sub.id}: ${errText(err)}`);
      return sub.id;
    }

    const actor = sub.submitted_by_user_id;
    const completed = known.statusCode === '0000' && known.transactionStatus === 'Completed';
    if (!completed) {
      // The URL's status is never used to close a row. Only bKash's own terminal answer does;
      // a non-terminal state (Initiated, Authorized, ...) or an error leaves it PENDING.
      const t = known.transactionStatus;
      if (t === 'Failed' || t === 'Cancelled') {
        await this.closeIfPending(
          sub.tenant_id,
          sub.id,
          t === 'Cancelled' ? 'CANCELLED' : 'FAILED',
          t === 'Cancelled' ? 'BKASH_CANCELLED' : 'BKASH_FAILED',
          actor,
        );
      }
      return sub.id;
    }
    const trxID = known.trxID;
    if (
      known.paymentID !== paymentID ||
      known.merchantInvoiceNumber !== sub.id ||
      known.currency !== 'BDT' ||
      bdtToPaisa(known.amount) !== BigInt(toPaisa(sub.amount)) ||
      typeof trxID !== 'string' ||
      trxID.length === 0 ||
      trxID.length > 100
    ) {
      // bKash took money for something that is not this submission: no payment, loud log for staff.
      this.logger.error(`bKash ORPHAN: Completed payment does not match submission ${sub.id}`);
      await this.closeIfPending(sub.tenant_id, sub.id, 'FAILED', 'MISMATCH', actor);
      return sub.id;
    }

    try {
      await this.ds.query(
        `UPDATE payment_submissions SET provider_trx_id = $1, updated_at = NOW()
          WHERE id = $2 AND tenant_id = $3 AND (provider_trx_id IS NULL OR provider_trx_id = $1)`,
        [trxID, sub.id, sub.tenant_id],
      );
    } catch (err) {
      if ((err as { code?: string }).code !== '23505') throw err;
      // The unique index (tenant, provider, trxID) caught a trxID already booked elsewhere.
      this.logger.error(`bKash ORPHAN: trxID already used, submission ${sub.id}`);
      await this.closeIfPending(sub.tenant_id, sub.id, 'FAILED', 'DUPLICATE_TRX', actor);
      return sub.id;
    }
    try {
      const res = await this.settlement.settle(sub.id, sub.tenant_id, actor, 'ONLINE_LENIENT');
      if (res.outcome === 'SETTLED' && !res.alreadySettled) {
        this.emit(PAYMENT_SUBMISSION_EVENTS.COMPLETED, sub.tenant_id, sub.id, actor);
      }
    } catch (err) {
      // Paid at bKash, not booked yet: the row stays as it was (trxID stored). Recovery is a
      // replayed callback or the reconciler lane (#3986); nothing here retries by itself.
      this.logger.error(`bKash ORPHAN: settle failed for submission ${sub.id}: ${errText(err)}`);
    }
    return sub.id;
  }

  /** `success` executes (bKash books the money then); anything else only reads. */
  private async confirm(
    paymentID: string,
    seen: CallbackStatus,
    creds: GatewayCreds,
  ): Promise<GatewayPayment> {
    if (seen === 'success') {
      const done = await this.bkash.execute(paymentID, creds);
      if (done.statusCode === '0000') return done;
    }
    // Already executed (a replay or a refresh), cancelled or failed: ask for the state.
    return this.bkash.query(paymentID, creds);
  }

  // ----------------------------------------------------------------- result

  /** Family-scoped: 404 unless the caller is linked to a child on one of its bills. */
  async result(id: string, ctx: ProofCaller): Promise<OnlinePaymentResultDto> {
    const linked = new Set(
      await this.familyAccess.getLinkedStudentIds(ctx.role, ctx.userId, ctx.tenantId),
    );
    const [s] = await this.ds.query(
      `SELECT id, status, unmatched, created_at FROM payment_submissions
        WHERE id = $1 AND tenant_id = $2 AND source = 'ONLINE'`,
      [id, ctx.tenantId],
    );
    const all: {
      student_fee_id: string;
      student_id: string;
      amount_at_start: string;
      payment_id: string | null;
    }[] = s
      ? await this.ds.query(
          `SELECT student_fee_id, student_id, amount_at_start, payment_id FROM payment_submission_bills
            WHERE submission_id = $1 AND tenant_id = $2`,
          [id, ctx.tenantId],
        )
      : [];
    const mine = all.filter((b) => linked.has(b.student_id));
    if (!s || mine.length === 0) throw new NotFoundException(MSG.notFound);
    const visible = mine.reduce((n, b) => n + toPaisa(b.amount_at_start), 0);
    // Receipts of the caller's own children only (the payment ids come from `mine`).
    const paymentIds = [...new Set(mine.flatMap((b) => (b.payment_id ? [b.payment_id] : [])))];
    const paid: { invoice_id: string; invoice_number: string; payment_date: Date }[] =
      paymentIds.length === 0
        ? []
        : await this.ds.query(
            `SELECT DISTINCT i.id AS invoice_id, i.invoice_number, p.payment_date
               FROM payments p
               JOIN invoices i ON i.id = p.invoice_id AND i.tenant_id = $2
              WHERE p.id = ANY($1::uuid[]) AND p.tenant_id = $2
              ORDER BY p.payment_date, i.invoice_number`,
            [paymentIds, ctx.tenantId],
          );
    return {
      id: s.id,
      status: s.status,
      amount: (visible / 100).toFixed(2),
      unmatched: s.unmatched,
      createdAt: s.created_at,
      receipts: paid.map((r) => ({ invoiceId: r.invoice_id, receiptNo: r.invoice_number })),
      paidAt: paid.length > 0 ? paid[paid.length - 1].payment_date : null,
      bills: mine.map((b) => ({
        studentFeeId: b.student_fee_id,
        studentId: b.student_id,
        amount: b.amount_at_start,
      })),
    };
  }

  // -------------------------------------------------------- test connection

  /** Token grant only (no payment). On success stamps `lastTestOkAt` (D13). */
  async testConnection(tenantId: string): Promise<{ ok: true; lastTestOkAt: string }> {
    const creds = await this.credsOf(tenantId);
    if (!creds) throw new BadRequestException(MSG.credsMissing);
    try {
      await this.bkash.testConnection(creds);
    } catch (err) {
      this.logger.warn(`bKash test failed for school ${tenantId}: ${errText(err)}`);
      throw new BadGatewayException(MSG.testFailed);
    }
    const at = new Date().toISOString();
    // ponytail: raw jsonb merge because SchoolsService is outside this ticket's territory;
    // move to a SchoolsService method when that file is free.
    await this.ds.query(
      `UPDATE schools SET settings = jsonb_set(
         jsonb_set(
           jsonb_set(COALESCE(settings,'{}'::jsonb), '{payments}',
                     COALESCE(settings->'payments','{}'::jsonb)),
           '{payments,bkash}', COALESCE(settings->'payments'->'bkash','{}'::jsonb)),
         '{payments,bkash,lastTestOkAt}', to_jsonb($1::text)), updated_at = NOW()
       WHERE id = $2`,
      [at, tenantId],
    );
    this.settingsCache.invalidate(tenantId);
    return { ok: true, lastTestOkAt: at };
  }

  // ---------------------------------------------------------------- helpers

  /** PENDING -> a final state, once; a row that already moved on is left alone. */
  private async closeIfPending(
    tenantId: string,
    id: string,
    to: 'FAILED' | 'CANCELLED',
    reason: string | null,
    actor: string,
  ): Promise<void> {
    const moved = await this.ds.transaction(async (m) => {
      // TypeORM's pg UPDATE returns [rows, affectedCount]
      const [upd] = (await m.query(
        `UPDATE payment_submissions SET status = $1, updated_at = NOW()
          WHERE id = $2 AND tenant_id = $3 AND status = 'PENDING' RETURNING id`,
        [to, id, tenantId],
      )) as [unknown[], number];
      if (upd.length === 0) return false;
      await this.event(m, tenantId, id, 'PENDING', to, actor, reason);
      return true;
    });
    if (moved && to === 'FAILED') this.emit(PAYMENT_SUBMISSION_EVENTS.FAILED, tenantId, id, actor);
  }

  private event(
    m: EntityManager,
    tenantId: string,
    submissionId: string,
    from: string | null,
    to: string,
    actor: string,
    reason: string | null,
  ) {
    return m.query(
      `INSERT INTO payment_submission_events
         (tenant_id, submission_id, from_status, to_status, actor_user_id, reason_code)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [tenantId, submissionId, from, to, actor, reason],
    );
  }

  private emit(name: string, tenantId: string, submissionId: string, actorUserId: string) {
    const payload: PaymentSubmissionEventPayload = { tenantId, submissionId, actorUserId };
    paymentSubmissionEvents.emit(name, payload);
  }
}

/** Error text for logs: the message only (BkashClient throws fixed text, never creds). */
function errText(err: unknown): string {
  return err instanceof Error ? err.message : 'error';
}
