import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, IsNull } from 'typeorm';
import { AuditAction, Permission, roleHasPermission } from '@biddaloy/shared';
import { PrintJobItem } from '../entities/print-job-item.entity';
import { AuditService } from '../../audit/audit.service';
import { QueryPrintHistoryDto } from './dto/print-history.dto';
import type { PrintCaller } from './print-jobs.service';

/**
 * One history row. Deliberately has NO `data_snapshot`: a list of ID-card
 * snapshots would put every holder's data in one response. The snapshot is only
 * returned by the single-item endpoint.
 */
const ROW_SELECT = `
  i.id AS item_id, i.job_id, i.created_at, u.full_name AS printed_by_name,
  t.name AS template_name, v.version AS template_version,
  i.document_kind, i.subject_type, i.subject_id, i.subject_label,
  i.copy_number, i.outcome, i.revoked_at, j.status AS job_status`;

// `users` is joined without a deleted_at filter on purpose: a removed staff member must still be named.
const ROW_FROM = `
  FROM print_job_items i
  JOIN print_jobs j ON j.id = i.job_id AND j.tenant_id = i.tenant_id
  JOIN print_template_versions v ON v.id = j.template_version_id
  JOIN print_templates t ON t.id = v.template_id
  LEFT JOIN users u ON u.id = j.printed_by`;

/**
 * ACR rows are confidential: only a caller with ACR_READ sees them, and never their own.
 * `$n` is the caller id parameter; used by every read and by revoke.
 */
const acrGate = (role: string, n: string) =>
  `(i.document_kind <> 'ACR_ASSESSMENT' OR (${roleHasPermission(role, Permission.ACR_READ)}
     AND NOT EXISTS (
       SELECT 1 FROM acr_assessments a
        WHERE a.id = i.subject_id AND a.tenant_id = i.tenant_id AND a.user_id = ${n}::uuid)))`;

const escapeLike = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`);

@Injectable()
export class PrintHistoryService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly audit: AuditService,
  ) {}

  /** Builds the WHERE for the list. Every value is a bound parameter. */
  private where(caller: PrintCaller, q: QueryPrintHistoryDto) {
    const params: unknown[] = [caller.tenantId, caller.userId];
    const clauses = ['i.tenant_id = $1', acrGate(caller.role, '$2')];
    const add = (sql: (n: string) => string, value: unknown) => {
      params.push(value);
      clauses.push(sql(`$${params.length}`));
    };
    if (q.document_kind) add((n) => `i.document_kind = ${n}`, q.document_kind);
    if (q.template_id) add((n) => `t.id = ${n}`, q.template_id);
    if (q.subject_type) add((n) => `i.subject_type = ${n}`, q.subject_type);
    if (q.subject_id) add((n) => `i.subject_id = ${n}`, q.subject_id);
    if (q.printed_by) add((n) => `j.printed_by = ${n}`, q.printed_by);
    if (q.from) add((n) => `i.created_at >= ${n}::timestamptz`, q.from);
    if (q.to) {
      // A date-only `to` means "through the end of that day".
      if (/^\d{4}-\d{2}-\d{2}$/.test(q.to)) {
        add((n) => `i.created_at < (${n}::date + 1)`, q.to);
      } else {
        add((n) => `i.created_at <= ${n}::timestamptz`, q.to);
      }
    }
    if (q.status) add((n) => `j.status = ${n}`, q.status);
    if (q.outcome) add((n) => `i.outcome = ${n}`, q.outcome);
    if (q.revoked === true) clauses.push('i.revoked_at IS NOT NULL');
    if (q.revoked === false) clauses.push('i.revoked_at IS NULL');
    if (q.q) add((n) => `i.subject_label ILIKE ${n} ESCAPE '\\'`, `%${escapeLike(q.q as string)}%`);
    return { sql: clauses.join(' AND '), params };
  }

  async list(caller: PrintCaller, q: QueryPrintHistoryDto) {
    const page = q.page || 1;
    const limit = q.limit || 20;
    const { sql, params } = this.where(caller, q);
    const [rows, count] = await Promise.all([
      this.ds.query(
        `SELECT ${ROW_SELECT} ${ROW_FROM} WHERE ${sql}
          ORDER BY i.created_at DESC, i.id DESC
          LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, (page - 1) * limit],
      ),
      this.ds.query(`SELECT count(*)::int AS n ${ROW_FROM} WHERE ${sql}`, params),
    ]);
    const total = count[0].n as number;
    return { data: rows, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  /** The single item, with the frozen snapshot and the version definition so the UI can re-render it. */
  async getItem(caller: PrintCaller, itemId: string) {
    const rows = await this.ds.query(
      `SELECT ${ROW_SELECT}, i.data_snapshot, i.revoke_reason, v.definition AS template_definition
       ${ROW_FROM} WHERE i.tenant_id = $1 AND i.id = $2 AND ${acrGate(caller.role, '$3')}`,
      [caller.tenantId, itemId, caller.userId],
    );
    if (rows.length === 0) throw new NotFoundException('Print item not found');
    // Staff snapshots are HR data: PRINT_HISTORY_READ alone must not reveal them.
    if (
      rows[0].subject_type === 'STAFF' &&
      !roleHasPermission(caller.role, Permission.STAFF_HR_READ)
    ) {
      throw new ForbiddenException('Missing permission: STAFF_HR_READ');
    }
    return rows[0];
  }

  /** Newest first, at most 100. Feeds the Documents tabs on a student / staff page. */
  async subjectHistory(
    caller: PrintCaller,
    subjectType: 'STUDENT' | 'STAFF' | 'ACR',
    subjectId: string,
  ) {
    // Staff cards carry HR data, so listing them needs the same permission as printing one (D18).
    if (subjectType === 'STAFF' && !roleHasPermission(caller.role, Permission.STAFF_HR_READ)) {
      throw new ForbiddenException('Missing permission: STAFF_HR_READ');
    }
    return this.ds.query(
      `SELECT ${ROW_SELECT} ${ROW_FROM}
        WHERE i.tenant_id = $1 AND i.subject_type = $2 AND i.subject_id = $3
          AND ${acrGate(caller.role, '$4')}
        ORDER BY i.created_at DESC, i.id DESC LIMIT 100`,
      [caller.tenantId, subjectType, subjectId, caller.userId],
    );
  }

  /** D22 / D47: revoke one copy. The conditional update makes a second revoke a 409, even under a race. */
  async revoke(caller: PrintCaller, itemId: string, reason: string) {
    return this.ds.transaction(async (manager) => {
      // Hidden ACR rows must not be revocable (or even confirmable as existing): same 404.
      const visible = await manager.query(
        `SELECT 1 FROM print_job_items i WHERE i.tenant_id = $1 AND i.id = $2 AND ${acrGate(caller.role, '$3')}`,
        [caller.tenantId, itemId, caller.userId],
      );
      if (visible.length === 0) throw new NotFoundException('Print item not found');
      const revokedAt = new Date();
      // Conditional update = the double-revoke guard, atomic even under a race.
      const updated = await manager.update(
        PrintJobItem,
        { id: itemId, tenant_id: caller.tenantId, revoked_at: IsNull() },
        { revoked_at: revokedAt, revoked_by: caller.userId, revoke_reason: reason },
      );
      if (updated.affected !== 1) {
        const exists = await manager.count(PrintJobItem, {
          where: { id: itemId, tenant_id: caller.tenantId },
        });
        if (!exists) throw new NotFoundException('Print item not found');
        throw new ConflictException('This document is already revoked');
      }
      await this.audit.record(
        {
          action: AuditAction.UPDATE,
          entity_type: 'PrintJobItem',
          entity_id: itemId,
          tenant_id: caller.tenantId,
          performed_by_user_id: caller.userId,
          old_values: { revoked_at: null },
          new_values: { revoked_at: revokedAt.toISOString(), revoke_reason: reason },
        },
        manager,
      );
      return { item_id: itemId, revoked_at: revokedAt.toISOString() };
    });
  }
}
