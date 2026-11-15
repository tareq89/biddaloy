import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectDataSource } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import { toPaisa } from '../../common/constants/money';
import { isDemoMode } from '../demo/demo-mode';
import { PaymentSubmissionSettlement } from '../fees/payment-submission-settlement.service';
import { BkashClient, bdtToPaisa } from '../payment-gateways/bkash/bkash.client';
import { GatewayCreds } from '../payment-gateways/payment-gateway.provider';
import { SchoolsService } from '../schools/schools.service';
import {
  PAYMENT_SUBMISSION_EVENTS,
  PaymentSubmissionEventPayload,
  paymentSubmissionEvents,
} from './payment-submission.events';

export const ONLINE_PAYMENTS_RECONCILE_QUEUE = 'online-payments-reconcile';
const JOB_ID = 'online-payments-reconcile';
const MAX_AGE_MS = 72 * 60 * 60 * 1000;
const UNSTARTED_MS = 30 * 60 * 1000;
const BATCH = 100;

interface Row {
  id: string;
  status: 'PENDING' | 'EXPIRED' | 'CANCELLED';
  amount: string;
  provider_payment_id: string | null;
  submitted_by_user_id: string;
  created_at: Date;
  cursor_at?: string; // created_at::text, keeps microseconds for the keyset cursor
}

/**
 * [3.6.02] Every 10 min, per school with online payments on: settle PENDING bKash submissions
 * whose callback was lost, FAIL the ones bKash rejected, EXPIRE the ones never started.
 * An EXPIRED or CANCELLED row (the callback settles both) that has a paymentID and is under 72 h old is asked too: the guardian may have
 * paid after the sweep, and `settle` accepts EXPIRED (same as the callback). Only a Completed
 * answer changes it; FAILED rows are never re-confirmed.
 * Logs carry ids only: never credentials or a raw bKash body (Rule 13).
 */
@Injectable()
@Processor(ONLINE_PAYMENTS_RECONCILE_QUEUE)
export class OnlinePaymentsReconciler extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(OnlinePaymentsReconciler.name);
  /** Stale (>72 h) count last logged per school: warn when it changes, not every 10 min. */
  private readonly staleLogged = new Map<string, number>();

  constructor(
    @InjectQueue(ONLINE_PAYMENTS_RECONCILE_QUEUE) private readonly queue: Queue,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly client: BkashClient,
    private readonly schools: SchoolsService,
    private readonly settlement: PaymentSubmissionSettlement,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    // No isConfigured() gate: that is operator env; schools bring their own credentials.
    if (isDemoMode()) {
      await this.queue.removeJobScheduler(JOB_ID);
      return;
    }
    await this.queue.upsertJobScheduler(
      JOB_ID,
      { every: 10 * 60 * 1000 },
      { opts: { removeOnComplete: true, removeOnFail: 100 } },
    );
  }

  async process(): Promise<void> {
    // Only rows inside the window decide who is decrypted; older PENDING ones are just counted.
    const tenants: { tenant_id: string; live: number; stale: number }[] =
      await this.dataSource.query(
        `SELECT tenant_id,
                count(*) FILTER (WHERE created_at > $1)::int AS live,
                count(*) FILTER (WHERE status = 'PENDING' AND created_at <= $1)::int AS stale
           FROM payment_submissions
          WHERE source = 'ONLINE' AND provider = 'BKASH'
            AND (status = 'PENDING'
                 OR (status IN ('EXPIRED', 'CANCELLED') AND provider_payment_id IS NOT NULL AND created_at > $1))
          GROUP BY tenant_id`,
        [new Date(Date.now() - MAX_AGE_MS)],
      );
    const active = new Set((await this.schools.findAllActive()).map((x) => x.id));
    for (const { tenant_id, live, stale } of tenants) {
      if (!active.has(tenant_id)) continue; // TEN-06: a suspended school gets no background work
      if (stale !== (this.staleLogged.get(tenant_id) ?? 0)) {
        this.staleLogged.set(tenant_id, stale);
        if (stale > 0) {
          this.logger.warn(
            `school ${tenant_id}: ${stale} online submissions PENDING over 72 h; need a human`,
          );
        }
      }
      if (live === 0) continue;
      try {
        await this.tenant(tenant_id);
      } catch (e) {
        this.logger.warn(`online reconcile skipped tenant ${tenant_id}: ${(e as Error).name}`);
      }
    }
  }

  private async tenant(tenantId: string): Promise<void> {
    const settings = await this.schools.getDecryptedSettings(tenantId);
    const pay = settings.payments;
    if (!pay?.onlineEnabled) return;
    const b = pay.bkash;
    const ok = (v: unknown) => typeof v === 'string' && v.length > 0;
    if (
      !b ||
      !ok(b.environment) ||
      !ok(b.appKey) ||
      !ok(b.appSecret) ||
      !ok(b.username) ||
      !ok(b.password)
    ) {
      this.logger.warn(`online reconcile: incomplete bKash settings for tenant ${tenantId}`);
      return;
    }
    const creds: GatewayCreds = {
      environment: b.environment as string,
      appKey: b.appKey as string,
      appSecret: b.appSecret as string,
      username: b.username as string,
      password: b.password as string,
      tenantId,
    };
    const now = Date.now();
    const cutoff = new Date(now - MAX_AGE_MS);
    // Keyset pages: rows left PENDING after a query must not hide older eligible ones.
    let cursor: { at: string; id: string } | null = null;
    for (;;) {
      const rows: Row[] = await this.dataSource.query(
        `SELECT id, status, amount, provider_payment_id, submitted_by_user_id, created_at,
                created_at::text AS cursor_at
           FROM payment_submissions
          WHERE tenant_id = $1 AND source = 'ONLINE' AND provider = 'BKASH' AND created_at > $2
            AND (environment = $3 OR provider_payment_id IS NULL)
            AND (status = 'PENDING' OR (status IN ('EXPIRED', 'CANCELLED') AND provider_payment_id IS NOT NULL))
            AND ($4::timestamptz IS NULL OR (created_at, id) < ($4::timestamptz, $5::uuid))
          ORDER BY created_at DESC, id DESC LIMIT $6`,
        [tenantId, cutoff, creds.environment, cursor?.at ?? null, cursor?.id ?? null, BATCH],
      );
      for (const row of rows) {
        try {
          await this.row(tenantId, row, creds, now);
        } catch {
          this.logger.warn(`online reconcile failed for submission ${row.id}`);
        }
      }
      if (rows.length < BATCH) return;
      const last = rows[rows.length - 1];
      cursor = { at: last.cursor_at as string, id: last.id };
    }
  }

  private async row(tenantId: string, row: Row, creds: GatewayCreds, now: number): Promise<void> {
    if (!row.provider_payment_id) {
      if (row.status !== 'PENDING') return;
      if (new Date(row.created_at).getTime() < now - UNSTARTED_MS) {
        await this.transition(tenantId, row, 'EXPIRED', 'NOT_STARTED');
      }
      return;
    }
    let res;
    try {
      res = await this.client.query(row.provider_payment_id, creds);
    } catch {
      return; // bKash down: stays PENDING, retried next run
    }
    if (res.transactionStatus === 'Completed') {
      const paid = bdtToPaisa(res.amount);
      if (
        paid === undefined ||
        paid !== BigInt(toPaisa(row.amount)) ||
        res.merchantInvoiceNumber !== row.id ||
        typeof res.trxID !== 'string' ||
        res.trxID.length === 0 ||
        res.trxID.length > 100 ||
        res.paymentID !== row.provider_payment_id ||
        res.currency !== 'BDT'
      ) {
        this.logger.warn(`online submission ${row.id}: amount/invoice mismatch; needs a human`);
        return;
      }
      try {
        // settle() reads provider_trx_id for checkout, so it is set first.
        await this.dataSource.query(
          `UPDATE payment_submissions SET provider_trx_id = $1 WHERE id = $2 AND tenant_id = $3 AND status IN ('PENDING', 'EXPIRED', 'CANCELLED')`,
          [res.trxID, row.id, tenantId],
        );
      } catch (e) {
        if ((e as { code?: string }).code !== '23505') throw e; // transient: row-level catch retries next run
        this.logger.warn(`online submission ${row.id}: trx id already used; needs a human`);
        return;
      }
      const out = await this.settlement.settle(
        row.id,
        tenantId,
        row.submitted_by_user_id,
        'ONLINE_LENIENT',
      );
      if (!out.alreadySettled) this.emit(PAYMENT_SUBMISSION_EVENTS.COMPLETED, tenantId, row);
    } else if (
      row.status === 'PENDING' &&
      (res.transactionStatus === 'Failed' || res.transactionStatus === 'Cancelled')
    ) {
      await this.transition(
        tenantId,
        row,
        'FAILED',
        res.transactionStatus === 'Failed' ? 'GATEWAY_FAILED' : 'GATEWAY_CANCELLED',
      );
    }
  }

  private async transition(
    tenantId: string,
    row: Row,
    to: 'FAILED' | 'EXPIRED',
    reason: string,
  ): Promise<void> {
    const changed = await this.dataSource.transaction(async (m) => {
      // TypeORM's pg UPDATE returns [rows, affectedCount]
      const [upd] = (await m.query(
        `UPDATE payment_submissions SET status = $1, updated_at = now()
          WHERE id = $2 AND tenant_id = $3 AND status = 'PENDING' RETURNING id`,
        [to, row.id, tenantId],
      )) as [unknown[], number];
      if (upd.length === 0) return false; // a late callback won
      await m.query(
        `INSERT INTO payment_submission_events
           (tenant_id, submission_id, from_status, to_status, actor_user_id, reason_code, note)
         VALUES ($1,$2,'PENDING',$3,$4,$5,NULL)`,
        [tenantId, row.id, to, row.submitted_by_user_id, reason],
      );
      return true;
    });
    if (changed) {
      this.emit(
        to === 'FAILED' ? PAYMENT_SUBMISSION_EVENTS.FAILED : PAYMENT_SUBMISSION_EVENTS.EXPIRED,
        tenantId,
        row,
      );
    }
  }

  private emit(name: string, tenantId: string, row: Row): void {
    const payload: PaymentSubmissionEventPayload = {
      tenantId,
      submissionId: row.id,
      actorUserId: row.submitted_by_user_id,
    };
    paymentSubmissionEvents.emit(name, payload);
  }
}
