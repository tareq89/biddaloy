import { createHash, randomUUID } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import {
  AuditAction,
  FeeStatus,
  PaymentSubmissionSource,
  PaymentSubmissionStatus,
} from '@biddaloy/shared';
import { toPaisa } from '../../common/constants/money';
import { AuditService } from '../audit/audit.service';
import { localToday } from '../attendance/attendance-policy.util';
import { SchoolsService } from '../schools/schools.service';
import { FamilyAccessService } from '../students/family-access.service';
import { StorageService, StoredObject } from '../storage/storage.service';
import { matchesDeclaredType } from '../storage/file-signature';
import { CreateProofSubmissionDto, ProofSubmissionResponseDto } from './dto/proof-submission.dto';
import {
  PAYMENT_SUBMISSION_EVENTS,
  PaymentSubmissionEventPayload,
  paymentSubmissionEvents,
} from './payment-submission.events';
import { findDuplicateFlag, normaliseReference } from './reference.util';

export const PROOF_MAX_FILES = 2;
export const PROOF_MAX_FILE_SIZE = 5 * 1024 * 1024;
/** D29: proofs one guardian may have waiting at once. */
export const PROOF_MAX_PENDING = 5;
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'application/pdf']);

/** Rule 23: one fixed sentence per failure, never the submitted value. */
const MSG = {
  billNotFound: 'Bill not found',
  proofNotFound: 'Payment proof not found',
  studentNotFound: 'Student not found',
  disabled: 'Payment proof is not available',
  method: 'This payment method is not accepted',
  billBusy: 'A selected bill cannot take a payment proof right now',
  amount: 'The amount does not match the selected bills',
  future: 'The payment date cannot be in the future',
  evidence: 'A transaction ID or a proof file is required',
  tooMany: 'Too many payment proofs are waiting for review',
  fileType: 'Files must be JPG, PNG or PDF',
  fileSize: 'A file is too large',
  storage: 'Proof upload is unavailable, try again later',
  notPending: 'Only a waiting proof can be withdrawn',
} as const;

export interface ProofCaller {
  tenantId: string;
  userId: string;
  role: string;
}

interface BillRow {
  id: string;
  student_id: string;
  balance: string;
  status: FeeStatus;
}

@Injectable()
export class ProofSubmissionsService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly familyAccess: FamilyAccessService,
    private readonly schools: SchoolsService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  /**
   * For the fee soft-delete guard (#3966): which of these bills have a live PENDING submission
   * (either source) in this tenant. RESTRICT FKs never fire on a soft delete, so fees calls this
   * with the caller's tenant id and answers 409.
   */
  async billsWithLiveSubmission(
    manager: EntityManager,
    tenantId: string,
    studentFeeIds: string[],
  ): Promise<string[]> {
    if (studentFeeIds.length === 0) return [];
    const rows: { id: string }[] = await manager.query(
      `SELECT DISTINCT b.student_fee_id AS id FROM payment_submission_bills b
         JOIN payment_submissions s ON s.id = b.submission_id AND s.tenant_id = $1
        WHERE s.status = 'PENDING' AND b.student_fee_id = ANY($2::uuid[])`,
      [tenantId, studentFeeIds],
    );
    return rows.map((r) => r.id);
  }

  private validateFiles(files: Express.Multer.File[]): void {
    for (const f of files) {
      if (f.size > PROOF_MAX_FILE_SIZE) throw new BadRequestException(MSG.fileSize);
      // The mimetype is client-sent; the leading bytes are not.
      if (!ALLOWED_MIME.has(f.mimetype) || !matchesDeclaredType(f.buffer, f.mimetype)) {
        throw new BadRequestException(MSG.fileType);
      }
    }
  }

  async submit(
    dto: CreateProofSubmissionDto,
    files: Express.Multer.File[],
    ctx: ProofCaller,
  ): Promise<ProofSubmissionResponseDto> {
    files = files ?? [];
    const settings = await this.schools.getResolvedSettings(ctx.tenantId);
    const pay = settings.payments;
    if (!pay?.proofEnabled) throw new BadRequestException(MSG.disabled);
    if (!pay.proofMethods.some((m) => m.method === dto.method)) {
      throw new BadRequestException(MSG.method);
    }
    // D43: paidOn is a calendar date in the school's own timezone.
    if (dto.paidOn > localToday(settings.region?.timezone ?? 'UTC')) {
      throw new BadRequestException(MSG.future);
    }
    const reference = normaliseReference(dto.reference);
    if (!reference && files.length === 0) throw new BadRequestException(MSG.evidence);
    this.validateFiles(files);

    const billIds = [...new Set(dto.billIds)];
    const linked = new Set(
      await this.familyAccess.getLinkedStudentIds(ctx.role, ctx.userId, ctx.tenantId),
    );

    // Cheap pre-check so a bad request writes no objects. The in-transaction checks stay
    // authoritative (locks, open, amount, pending rows).
    const [{ found }] = await this.ds.query(
      `SELECT COUNT(*)::int AS found FROM student_fees sf
         JOIN students s ON s.id = sf.student_id AND s.tenant_id = $1 AND s.deleted_at IS NULL
        WHERE sf.id = ANY($2::uuid[]) AND sf.deleted_at IS NULL AND sf.student_id = ANY($3::uuid[])`,
      [ctx.tenantId, billIds, [...linked]],
    );
    if (found !== billIds.length) throw new NotFoundException(MSG.billNotFound);
    const [{ n: waiting }] = await this.ds.query(
      `SELECT COUNT(*)::int AS n FROM payment_submissions
        WHERE tenant_id = $1 AND submitted_by_user_id = $2 AND status = 'PENDING' AND source = 'PROOF'`,
      [ctx.tenantId, ctx.userId],
    );
    if (waiting >= PROOF_MAX_PENDING) throw new ConflictException(MSG.tooMany);

    // Storage first, with keys built from the pre-generated submission id (D37).
    const submissionId = randomUUID();
    const stored: { key: string; file: Express.Multer.File }[] = [];
    try {
      for (const file of files) {
        const key = `tenants/${ctx.tenantId}/payment-proofs/${submissionId}/${randomUUID()}`;
        await this.storage.put(key, file.buffer, file.mimetype);
        stored.push({ key, file });
      }
    } catch {
      await this.cleanup(
        stored.map((s) => s.key),
        ctx.tenantId,
      );
      throw new ServiceUnavailableException(MSG.storage);
    }

    let duplicate: string | null = null;
    try {
      await this.ds.transaction(async (m) => {
        // Serialise one guardian's submits so two cannot both slip under the cap (D29).
        await m.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
          `${ctx.tenantId}:${ctx.userId}`,
        ]);
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
        // Missing, other tenant or other family: the same 404.
        if (bills.length !== billIds.length || bills.some((b) => !linked.has(b.student_id))) {
          throw new NotFoundException(MSG.billNotFound);
        }
        const open = (b: BillRow) =>
          b.status !== FeeStatus.PAID && b.status !== FeeStatus.WAIVED && toPaisa(b.balance) > 0;
        const busy = await this.billsWithLiveSubmission(m, ctx.tenantId, billIds);
        if (!bills.every(open) || busy.length > 0) throw new ConflictException(MSG.billBusy);

        const [{ n }] = await m.query(
          `SELECT COUNT(*)::int AS n FROM payment_submissions
            WHERE tenant_id = $1 AND submitted_by_user_id = $2 AND status = 'PENDING' AND source = 'PROOF'`,
          [ctx.tenantId, ctx.userId],
        );
        if (n >= PROOF_MAX_PENDING) throw new ConflictException(MSG.tooMany);

        // D26: whole paisa, no tolerance.
        const total = bills.reduce((s, b) => s + toPaisa(b.balance), 0);
        if (total !== toPaisa(dto.amount)) throw new BadRequestException(MSG.amount);

        duplicate = await findDuplicateFlag(m, ctx.tenantId, reference, submissionId);

        await m.query(
          `INSERT INTO payment_submissions
             (id, tenant_id, source, status, submitted_by_user_id, method, amount, paid_on,
              reference_raw, reference_normalised)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            submissionId,
            ctx.tenantId,
            PaymentSubmissionSource.PROOF,
            PaymentSubmissionStatus.PENDING,
            ctx.userId,
            dto.method,
            (total / 100).toFixed(2),
            dto.paidOn,
            dto.reference?.trim() || null,
            reference,
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
        for (const { key, file } of stored) {
          await m.query(
            `INSERT INTO payment_submission_files
               (tenant_id, submission_id, storage_key, content_type, size_bytes, original_name_hash)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [
              ctx.tenantId,
              submissionId,
              key,
              file.mimetype,
              file.size,
              createHash('sha256')
                .update(file.originalname ?? '')
                .digest('hex'),
            ],
          );
        }
        // Duplicate flag is kept for the reviewer in the opening event's reason_code (D25).
        await this.event(m, ctx, submissionId, null, PaymentSubmissionStatus.PENDING, duplicate);
        await this.audit.record(
          {
            action: AuditAction.CREATE,
            entity_type: 'PaymentSubmission',
            entity_id: submissionId,
            tenant_id: ctx.tenantId,
            performed_by_user_id: ctx.userId,
            new_values: { source: 'PROOF', bills: bills.length, files: stored.length },
          },
          m,
        );
      });
    } catch (e) {
      // Nothing was saved: drop the objects (best effort).
      await this.cleanup(
        stored.map((s) => s.key),
        ctx.tenantId,
      );
      throw e;
    }
    this.emit(PAYMENT_SUBMISSION_EVENTS.SUBMITTED, ctx, submissionId);
    return this.getOne(submissionId, ctx);
  }

  async withdraw(id: string, ctx: ProofCaller): Promise<ProofSubmissionResponseDto> {
    await this.ds.transaction(async (m) => {
      const [row] = await m.query(
        `SELECT status, submitted_by_user_id FROM payment_submissions
          WHERE id = $1 AND tenant_id = $2 AND source = 'PROOF' FOR UPDATE`,
        [id, ctx.tenantId],
      );
      // D41: only the submitter. Anyone else gets the not-found answer.
      if (!row || row.submitted_by_user_id !== ctx.userId) {
        throw new NotFoundException(MSG.proofNotFound);
      }
      if (row.status !== PaymentSubmissionStatus.PENDING) {
        throw new ConflictException(MSG.notPending);
      }
      await m.query(
        `UPDATE payment_submissions SET status = 'WITHDRAWN', updated_at = NOW() WHERE id = $1`,
        [id],
      );
      await this.event(
        m,
        ctx,
        id,
        PaymentSubmissionStatus.PENDING,
        PaymentSubmissionStatus.WITHDRAWN,
        null,
      );
      await this.audit.record(
        {
          action: AuditAction.UPDATE,
          entity_type: 'PaymentSubmission',
          entity_id: id,
          tenant_id: ctx.tenantId,
          performed_by_user_id: ctx.userId,
          old_values: { status: 'PENDING' },
          new_values: { status: 'WITHDRAWN' },
        },
        m,
      );
    });
    this.emit(PAYMENT_SUBMISSION_EVENTS.WITHDRAWN, ctx, id);
    return this.getOne(id, ctx);
  }

  /** Any linked guardian of a covered child sees the proof, not only the submitter. */
  async list(
    ctx: ProofCaller,
    studentId: string | undefined,
    limit = 50,
  ): Promise<ProofSubmissionResponseDto[]> {
    let ids = await this.familyAccess.getLinkedStudentIds(ctx.role, ctx.userId, ctx.tenantId);
    if (studentId) {
      if (!ids.includes(studentId)) throw new NotFoundException(MSG.studentNotFound);
      ids = [studentId];
    }
    if (ids.length === 0) return [];
    const rows: { id: string }[] = await this.ds.query(
      `SELECT s.id FROM payment_submissions s
        WHERE s.tenant_id = $1 AND s.source = 'PROOF'
          AND EXISTS (SELECT 1 FROM payment_submission_bills b
                       WHERE b.submission_id = s.id AND b.student_id = ANY($2::uuid[]))
        ORDER BY s.created_at DESC, s.id LIMIT $3`,
      [ctx.tenantId, ids, limit],
    );
    return this.load(
      rows.map((r) => r.id),
      ctx,
    );
  }

  /** Streams one proof file; 404 unless the caller is linked to a covered child. */
  async file(
    id: string,
    fileId: string,
    ctx: ProofCaller,
  ): Promise<StoredObject & { contentType: string }> {
    const linked = await this.familyAccess.getLinkedStudentIds(ctx.role, ctx.userId, ctx.tenantId);
    const [row] = await this.ds.query(
      `SELECT f.storage_key, f.content_type FROM payment_submission_files f
        WHERE f.id = $1 AND f.submission_id = $2 AND f.tenant_id = $3
          AND EXISTS (SELECT 1 FROM payment_submission_bills b
                       WHERE b.submission_id = f.submission_id AND b.student_id = ANY($4::uuid[]))`,
      [fileId, id, ctx.tenantId, linked],
    );
    if (!row) throw new NotFoundException(MSG.proofNotFound);
    try {
      const obj = await this.storage.getForTenant(row.storage_key, ctx.tenantId);
      return { body: obj.body, contentType: row.content_type };
    } catch {
      throw new NotFoundException(MSG.proofNotFound);
    }
  }

  private async getOne(id: string, ctx: ProofCaller): Promise<ProofSubmissionResponseDto> {
    return (await this.load([id], ctx))[0];
  }

  /**
   * A multi-child proof shows the caller only the bills of children they are linked to; the
   * amount is the sum of those visible bills so another family's money is not disclosed.
   */
  private async load(ids: string[], ctx: ProofCaller): Promise<ProofSubmissionResponseDto[]> {
    if (ids.length === 0) return [];
    const tenantId = ctx.tenantId;
    const linked = new Set(
      await this.familyAccess.getLinkedStudentIds(ctx.role, ctx.userId, tenantId),
    );
    const [subs, bills, files] = await Promise.all([
      this.ds.query(
        `SELECT * FROM payment_submissions WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
        [tenantId, ids],
      ),
      this.ds.query(
        `SELECT * FROM payment_submission_bills WHERE tenant_id = $1 AND submission_id = ANY($2::uuid[])`,
        [tenantId, ids],
      ),
      this.ds.query(
        `SELECT * FROM payment_submission_files WHERE tenant_id = $1 AND submission_id = ANY($2::uuid[])`,
        [tenantId, ids],
      ),
    ]);
    const byId = new Map<string, any>(subs.map((s: any) => [s.id, s]));
    return ids
      .filter((id) => byId.has(id))
      .map((id) => {
        const s = byId.get(id);
        const mine = bills.filter((b: any) => b.submission_id === id && linked.has(b.student_id));
        const visible = mine.reduce((n: number, b: any) => n + toPaisa(b.amount_at_start), 0);
        return {
          id,
          status: s.status,
          method: s.method,
          amount: (visible / 100).toFixed(2),
          paidOn: s.paid_on,
          reference: s.reference_raw,
          submittedByUserId: s.submitted_by_user_id,
          createdAt: s.created_at,
          bills: mine.map((b: any) => ({
            studentFeeId: b.student_fee_id,
            studentId: b.student_id,
            amount: b.amount_at_start,
          })),
          files: files
            .filter((f: any) => f.submission_id === id)
            .map((f: any) => ({ id: f.id, contentType: f.content_type, sizeBytes: f.size_bytes })),
        };
      });
  }

  private event(
    m: EntityManager,
    ctx: ProofCaller,
    submissionId: string,
    from: PaymentSubmissionStatus | null,
    to: PaymentSubmissionStatus,
    reason: string | null,
  ) {
    return m.query(
      `INSERT INTO payment_submission_events
         (tenant_id, submission_id, from_status, to_status, actor_user_id, reason_code)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [ctx.tenantId, submissionId, from, to, ctx.userId, reason],
    );
  }

  private emit(name: string, ctx: ProofCaller, submissionId: string) {
    const payload: PaymentSubmissionEventPayload = {
      tenantId: ctx.tenantId,
      submissionId,
      actorUserId: ctx.userId,
    };
    paymentSubmissionEvents.emit(name, payload);
  }

  private async cleanup(keys: string[], tenantId: string) {
    await Promise.all(
      keys.map((k) => this.storage.deleteForTenant(k, tenantId).catch(() => undefined)),
    );
  }
}
