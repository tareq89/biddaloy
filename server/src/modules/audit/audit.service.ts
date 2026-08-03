import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { AuditLog } from './entities/audit-log.entity';
import { AuditAction } from '@beton-boi/shared';
import { redactSensitiveFields } from './redact.util';
import { QueryAuditLogDto } from './dto/audit-log.dto';

export interface RecordAuditEntryInput {
  action: AuditAction;
  entity_type: string;
  entity_id?: string | null;
  tenant_id: string | null;
  performed_by_user_id?: string | null;
  ip_address?: string | null;
  user_agent?: string | null;
  old_values?: Record<string, unknown> | null;
  new_values?: Record<string, unknown> | null;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(AuditLog)
    private readonly repo: Repository<AuditLog>,
  ) {}

  /**
   * The single entry point for writing an audit row — no other module
   * should hold an `@InjectRepository(AuditLog)` of its own.
   *
   * Pass `manager` when this write must participate in an existing
   * transaction (e.g. payment-allocation's payment+audit write): a failure
   * then propagates and rolls back with the business operation, exactly
   * matching that call site's prior direct-repository behavior.
   *
   * Without a manager, this call is ancillary to an already-decided,
   * user-facing outcome (a login, a fee-structure edit, a reminder send) —
   * a transient DB error here must not turn a successful action into a
   * 500, so the failure is caught and logged instead of thrown, matching
   * auth.service.ts's pre-existing writeAuditLog behavior.
   */
  async record(entry: RecordAuditEntryInput, manager?: EntityManager): Promise<void> {
    if (manager) {
      const repo = manager.getRepository(AuditLog);
      const sanitized = {
        ...entry,
        old_values: entry.old_values ? redactSensitiveFields(entry.old_values) : null,
        new_values: entry.new_values ? redactSensitiveFields(entry.new_values) : null,
      };
      await repo.save(repo.create(sanitized));
      return;
    }

    // Redaction runs inside the try too — a malformed snapshot (e.g. a
    // circular structure) must fail open here exactly like a DB error
    // would, not bypass the fail-open guard below it.
    try {
      const sanitized = {
        ...entry,
        old_values: entry.old_values ? redactSensitiveFields(entry.old_values) : null,
        new_values: entry.new_values ? redactSensitiveFields(entry.new_values) : null,
      };
      await this.repo.save(this.repo.create(sanitized));
    } catch (error) {
      this.logger.error(
        `Failed to write ${entry.action} audit record: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  async findAll(query: QueryAuditLogDto, tenantId: string) {
    const page = query.page || 1;
    const limit = query.limit || 10;
    const skip = (page - 1) * limit;

    const qb = this.repo
      .createQueryBuilder('audit_log')
      .where('audit_log.tenant_id = :tenantId', { tenantId })
      .orderBy('audit_log.created_at', 'DESC');

    if (query.action) {
      qb.andWhere('audit_log.action = :action', { action: query.action });
    }
    if (query.entity_type) {
      qb.andWhere('audit_log.entity_type = :entityType', { entityType: query.entity_type });
    }
    if (query.from_date) {
      qb.andWhere('audit_log.created_at >= :fromDate', { fromDate: query.from_date });
    }
    if (query.to_date) {
      // A date-only value (no time component) must include the whole day —
      // otherwise Postgres casts it to that day's midnight and every row
      // from the day itself is excluded from what's meant to be an
      // inclusive range end.
      const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(query.to_date);
      const toDate = new Date(query.to_date);
      if (isDateOnly) {
        toDate.setUTCHours(23, 59, 59, 999);
      }
      qb.andWhere('audit_log.created_at <= :toDate', { toDate });
    }

    const [data, total] = await qb.skip(skip).take(limit).getManyAndCount();

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }
}
