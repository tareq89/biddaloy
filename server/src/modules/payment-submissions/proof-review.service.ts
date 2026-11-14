import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AuditAction, PaymentSubmissionStatus } from '@biddaloy/shared';
import { toPaisa } from '../../common/constants/money';
import { AuditService } from '../audit/audit.service';
import { PaymentSubmissionSettlement } from '../fees/payment-submission-settlement.service';
import { StorageService, StoredObject } from '../storage/storage.service';
import { RejectProofDto, ReopenProofDto } from './dto/proof-review.dto';
import {
  PAYMENT_SUBMISSION_EVENTS,
  PaymentSubmissionEventPayload,
  paymentSubmissionEvents,
} from './payment-submission.events';
import { findDuplicateFlag } from './reference.util';

/** Rule 23: one fixed sentence per failure, never the submitted value. */
const MSG = {
  notFound: 'Payment proof not found',
  notPending: 'Only a waiting proof can be decided',
  notRejected: 'Only a rejected proof can be reopened',
  confirmedReject:
    'A confirmed payment cannot be rejected here, reverse the payment from its receipt instead',
  billBusy: 'Another payment proof is already waiting for one of these bills',
  badCursor: 'The page cursor is not valid',
} as const;

export interface ReviewCaller {
  tenantId: string;
  userId: string;
}

const DEFAULT_LIMIT = 50;

@Injectable()
export class ProofReviewService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly settlement: PaymentSubmissionSettlement,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  /** Oldest first, so the longest-waiting proof is on top. Cursor = created_at + id. */
  async list(
    ctx: ReviewCaller,
    q: { source?: string; status?: string; limit?: number; cursor?: string },
  ) {
    const limit = q.limit ?? DEFAULT_LIMIT;
    let after: { at: string; id: string } | null = null;
    if (q.cursor) {
      const [at, id] = Buffer.from(q.cursor, 'base64url').toString().split('|');
      if (!at || !id || !/^[0-9 :.+-]{10,40}$/.test(at) || !/^[0-9a-f-]{36}$/i.test(id)) {
        throw new BadRequestException(MSG.badCursor);
      }
      after = { at, id };
    }
    const rows: Record<string, any>[] = await this.ds.query(
      `SELECT s.id, s.source, s.status, s.method, s.amount, s.paid_on, s.reference_raw, s.created_at,
              s.created_at::text AS cursor_at,
              u.full_name AS submitter_name,
              (SELECT COUNT(*)::int FROM payment_submission_bills b WHERE b.submission_id = s.id) AS bill_count
         FROM payment_submissions s JOIN users u ON u.id = s.submitted_by_user_id
        WHERE s.tenant_id = $1
          AND ($2::text IS NULL OR s.source::text = $2)
          AND ($3::text IS NULL OR s.status::text = $3)
          AND ($4::timestamptz IS NULL OR (s.created_at, s.id) > ($4::timestamptz, $5::uuid))
        ORDER BY s.created_at, s.id LIMIT $6`,
      [
        ctx.tenantId,
        q.source ?? null,
        q.status ?? null,
        after?.at ?? null,
        after?.id ?? null,
        limit + 1,
      ],
    );
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: page.map((r) => ({
        id: r.id,
        source: r.source,
        status: r.status,
        method: r.method,
        amount: r.amount,
        paidOn: r.paid_on,
        reference: r.reference_raw,
        submitterName: r.submitter_name,
        billCount: r.bill_count,
        createdAt: r.created_at,
      })),
      nextCursor:
        rows.length > limit
          ? // Text keeps Postgres microseconds; a JS Date would cut them and repeat a row.
            Buffer.from(`${last.cursor_at}|${last.id}`).toString('base64url')
          : null,
    };
  }

  async detail(id: string, ctx: ReviewCaller) {
    const t = ctx.tenantId;
    const [s] = await this.ds.query(
      `SELECT s.*, u.full_name AS submitter_name, u.phone AS submitter_phone
         FROM payment_submissions s JOIN users u ON u.id = s.submitted_by_user_id
        WHERE s.id = $1 AND s.tenant_id = $2`,
      [id, t],
    );
    if (!s) throw new NotFoundException(MSG.notFound);
    const [bills, files, events, next] = await Promise.all([
      this.ds.query(
        `SELECT b.student_fee_id, b.student_id, b.amount_at_start, b.payment_id,
                st.full_name AS student_name,
                (sf.total_amount - sf.discount_amount - sf.paid_amount)::text AS balance_now,
                sf.status AS bill_status, sf.deleted_at
           FROM payment_submission_bills b
           JOIN students st ON st.id = b.student_id AND st.tenant_id = $2
           JOIN student_fees sf ON sf.id = b.student_fee_id
          WHERE b.submission_id = $1 AND b.tenant_id = $2 ORDER BY b.student_id, b.student_fee_id`,
        [id, t],
      ),
      this.ds.query(
        `SELECT id, content_type, size_bytes FROM payment_submission_files
          WHERE submission_id = $1 AND tenant_id = $2 ORDER BY created_at, id`,
        [id, t],
      ),
      this.ds.query(
        `SELECT e.from_status, e.to_status, e.actor_user_id, e.reason_code, e.note, e.created_at
           FROM payment_submission_events e
          WHERE e.submission_id = $1 AND e.tenant_id = $2 ORDER BY e.created_at, e.id`,
        [id, t],
      ),
      this.ds.query(
        `SELECT id FROM payment_submissions
          WHERE tenant_id = $1 AND status = 'PENDING' AND source = 'PROOF' AND id <> $2
          ORDER BY created_at, id LIMIT 1`,
        [t, id],
      ),
    ]);
    const duplicateFlag =
      s.status === PaymentSubmissionStatus.PENDING
        ? await findDuplicateFlag(this.ds.manager, t, s.reference_normalised, id)
        : null;
    // D25 warning: a bill already settled or changed since the proof was sent.
    const billAlreadyPaid =
      s.status === PaymentSubmissionStatus.PENDING &&
      bills.some(
        (b: any) =>
          b.deleted_at !== null ||
          b.bill_status === 'PAID' ||
          b.bill_status === 'WAIVED' ||
          toPaisa(b.balance_now) !== toPaisa(b.amount_at_start),
      );
    return {
      id: s.id,
      source: s.source,
      status: s.status,
      method: s.method,
      amount: s.amount,
      paidOn: s.paid_on,
      reference: s.reference_raw,
      createdAt: s.created_at,
      guardian: {
        userId: s.submitted_by_user_id,
        name: s.submitter_name,
        phone: s.submitter_phone,
      },
      rejectReason: s.reject_reason,
      rejectNote: s.reject_note,
      discardReason: s.discard_reason,
      duplicateFlag,
      billAlreadyPaid,
      bills: bills.map((b: any) => ({
        studentFeeId: b.student_fee_id,
        studentId: b.student_id,
        studentName: b.student_name,
        amount: b.amount_at_start,
        paymentId: b.payment_id,
      })),
      files: files.map((f: any) => ({
        id: f.id,
        contentType: f.content_type,
        sizeBytes: f.size_bytes,
      })),
      events: events.map((e: any) => ({
        fromStatus: e.from_status,
        toStatus: e.to_status,
        actorUserId: e.actor_user_id,
        reasonCode: e.reason_code,
        note: e.note,
        createdAt: e.created_at,
      })),
      next_pending_id: next[0]?.id ?? null,
    };
  }

  async file(
    id: string,
    fileId: string,
    ctx: ReviewCaller,
  ): Promise<StoredObject & { contentType: string }> {
    const [row] = await this.ds.query(
      `SELECT storage_key, content_type FROM payment_submission_files
        WHERE id = $1 AND submission_id = $2 AND tenant_id = $3`,
      [fileId, id, ctx.tenantId],
    );
    if (!row) throw new NotFoundException(MSG.notFound);
    try {
      const obj = await this.storage.getForTenant(row.storage_key, ctx.tenantId);
      return { body: obj.body, contentType: row.content_type };
    } catch {
      throw new NotFoundException(MSG.notFound);
    }
  }

  /** Settlement does the money and writes its own history row; this adds audit and the event. */
  async confirm(id: string, ctx: ReviewCaller) {
    const [row] = await this.ds.query(
      `SELECT status FROM payment_submissions WHERE id = $1 AND tenant_id = $2 AND source = 'PROOF'`,
      [id, ctx.tenantId],
    );
    if (!row) throw new NotFoundException(MSG.notFound);
    // Confirming an already confirmed proof is a replay (D27): settle returns the same payments.
    if (
      row.status !== PaymentSubmissionStatus.PENDING &&
      row.status !== PaymentSubmissionStatus.CONFIRMED &&
      row.status !== PaymentSubmissionStatus.DISCARDED
    ) {
      throw new ConflictException(MSG.notPending);
    }
    const res = await this.settlement.settle(id, ctx.tenantId, ctx.userId, 'PROOF_STRICT');
    if (!res.alreadySettled && row.status === PaymentSubmissionStatus.PENDING) {
      const settled = res.outcome === 'SETTLED';
      await this.audit.record({
        action: AuditAction.UPDATE,
        entity_type: 'PaymentSubmission',
        entity_id: id,
        tenant_id: ctx.tenantId,
        performed_by_user_id: ctx.userId,
        old_values: { status: 'PENDING' },
        new_values: {
          status: settled ? 'CONFIRMED' : 'DISCARDED',
          payments: res.paymentIds.length,
        },
      });
      this.emit(
        settled ? PAYMENT_SUBMISSION_EVENTS.CONFIRMED : PAYMENT_SUBMISSION_EVENTS.DISCARDED,
        ctx,
        id,
      );
    }
    return { outcome: res.outcome, paymentIds: res.paymentIds, detail: await this.detail(id, ctx) };
  }

  async reject(id: string, dto: RejectProofDto, ctx: ReviewCaller) {
    await this.ds.transaction(async (m) => {
      const row = await this.lock(m, id, ctx);
      if (
        row.status === PaymentSubmissionStatus.CONFIRMED ||
        row.status === PaymentSubmissionStatus.REVERSED
      ) {
        throw new ConflictException({
          message: MSG.confirmedReject,
          details: { code: 'PROOF_CONFIRMED_USE_REVERSAL' },
        });
      }
      if (row.status !== PaymentSubmissionStatus.PENDING)
        throw new ConflictException(MSG.notPending);
      await m.query(
        `UPDATE payment_submissions
            SET status = 'REJECTED', reject_reason = $3, reject_note = $4,
                decided_by_user_id = $5, decided_at = NOW(), updated_at = NOW()
          WHERE id = $1 AND tenant_id = $2`,
        [id, ctx.tenantId, dto.reason, dto.note ?? null, ctx.userId],
      );
      await this.event(m, ctx, id, 'PENDING', 'REJECTED', dto.reason, dto.note ?? null);
      await this.audit.record(
        {
          action: AuditAction.UPDATE,
          entity_type: 'PaymentSubmission',
          entity_id: id,
          tenant_id: ctx.tenantId,
          performed_by_user_id: ctx.userId,
          old_values: { status: 'PENDING' },
          new_values: { status: 'REJECTED', reason: dto.reason },
        },
        m,
      );
    });
    this.emit(PAYMENT_SUBMISSION_EVENTS.REJECTED, ctx, id);
    return this.detail(id, ctx);
  }

  async reopen(id: string, dto: ReopenProofDto, ctx: ReviewCaller) {
    await this.ds.transaction(async (m) => {
      const row = await this.lock(m, id, ctx);
      if (row.status !== PaymentSubmissionStatus.REJECTED)
        throw new ConflictException(MSG.notRejected);
      // The bills were free while rejected: another proof may be waiting on them now.
      const [busy] = await m.query(
        `SELECT 1 FROM payment_submission_bills mine
           JOIN payment_submission_bills o ON o.student_fee_id = mine.student_fee_id
            AND o.submission_id <> mine.submission_id
           JOIN payment_submissions os ON os.id = o.submission_id AND os.tenant_id = $2
            AND os.status = 'PENDING'
          WHERE mine.submission_id = $1 AND mine.tenant_id = $2 LIMIT 1`,
        [id, ctx.tenantId],
      );
      if (busy) throw new ConflictException(MSG.billBusy);
      await m.query(
        `UPDATE payment_submissions
            SET status = 'PENDING', reject_reason = NULL, reject_note = NULL,
                decided_by_user_id = NULL, decided_at = NULL, updated_at = NOW()
          WHERE id = $1 AND tenant_id = $2`,
        [id, ctx.tenantId],
      );
      await this.event(m, ctx, id, 'REJECTED', 'PENDING', 'REOPENED', dto.note);
      await this.audit.record(
        {
          action: AuditAction.UPDATE,
          entity_type: 'PaymentSubmission',
          entity_id: id,
          tenant_id: ctx.tenantId,
          performed_by_user_id: ctx.userId,
          old_values: { status: 'REJECTED' },
          new_values: { status: 'PENDING', reopened: true },
        },
        m,
      );
    });
    return this.detail(id, ctx);
  }

  private async lock(m: DataSource['manager'], id: string, ctx: ReviewCaller) {
    const [row] = await m.query(
      `SELECT status FROM payment_submissions
        WHERE id = $1 AND tenant_id = $2 AND source = 'PROOF' FOR UPDATE`,
      [id, ctx.tenantId],
    );
    if (!row) throw new NotFoundException(MSG.notFound);
    return row as { status: PaymentSubmissionStatus };
  }

  // Append-only: insert only, never update or delete an event row.
  private event(
    m: DataSource['manager'],
    ctx: ReviewCaller,
    id: string,
    from: string,
    to: string,
    reason: string,
    note: string | null,
  ) {
    return m.query(
      `INSERT INTO payment_submission_events
         (tenant_id, submission_id, from_status, to_status, actor_user_id, reason_code, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [ctx.tenantId, id, from, to, ctx.userId, reason, note],
    );
  }

  private emit(name: string, ctx: ReviewCaller, submissionId: string) {
    const payload: PaymentSubmissionEventPayload = {
      tenantId: ctx.tenantId,
      submissionId,
      actorUserId: ctx.userId,
    };
    paymentSubmissionEvents.emit(name, payload);
  }
}
