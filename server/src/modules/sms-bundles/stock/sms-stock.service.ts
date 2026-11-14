import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, IsNull } from 'typeorm';
import { ApprovalScope, AuditAction } from '@biddaloy/shared';
import { toPaisa } from '../../../common/constants/money';
import { AuditService } from '../../audit/audit.service';
import { PlatformHomeService } from '../../platform-identity/platform-home.service';
import { SmsProviderBalanceReading } from '../entities/sms-provider-balance-reading.entity';
import { SmsStockEntry } from '../entities/sms-stock-entry.entity';
import type { RecordSmsStockDto, SmsStockEntryDto, SmsStockPageDto } from './dto/sms-stock.dto';

const BAD_CURSOR = 'Invalid cursor';
const NOT_FOUND = 'SMS stock entry not found';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TS_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?[+-]\d{2}(:\d{2})?$/;

const encode = (ts: string, id: string) =>
  Buffer.from(JSON.stringify([ts, id])).toString('base64url');

function decode(cursor?: string): [string | null, string | null] {
  if (!cursor) return [null, null];
  try {
    const v: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (
      Array.isArray(v) &&
      v.length === 2 &&
      typeof v[0] === 'string' &&
      typeof v[1] === 'string' &&
      TS_RE.test(v[0]) &&
      UUID_RE.test(v[1])
    )
      return [v[0], v[1]];
  } catch {
    /* fall through */
  }
  throw new BadRequestException(BAD_CURSOR);
}

export interface Actor {
  userId: string;
  ip?: string | null;
  userAgent?: string | null;
}

/** [100.2.A1] The owner's record of SMS blocks bought from the provider. Never touches sms_credit_*. */
@Injectable()
export class SmsStockService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly audit: AuditService,
    private readonly home: PlatformHomeService,
  ) {}

  async list(limit = 25, cursor?: string): Promise<SmsStockPageDto> {
    const n = Math.min(Math.max(limit, 1), 100);
    const [cts, cid] = decode(cursor);
    const rows: Array<{
      id: string;
      bought_on: string;
      sms_count: number;
      cost_paisa: string;
      note: string | null;
      ts: string;
      created_at: Date;
    }> = await this.ds.query(
      `SELECT id, bought_on::text AS bought_on, sms_count, cost_paisa::text AS cost_paisa, note,
              created_at::text AS ts, created_at
         FROM sms_stock_entries
        WHERE deleted_at IS NULL
          AND ($1::timestamptz IS NULL OR (created_at, id) < ($1::timestamptz, $2::uuid))
        ORDER BY created_at DESC, id DESC
        LIMIT $3`,
      [cts, cid, n + 1],
    );
    const page = rows.slice(0, n);
    const last = page[page.length - 1];
    return {
      items: page.map((r): SmsStockEntryDto => ({
        id: r.id,
        boughtOn: r.bought_on,
        smsCount: r.sms_count,
        costPaisa: r.cost_paisa,
        note: r.note,
        createdAt: new Date(r.created_at).toISOString(),
      })),
      nextCursor: rows.length > n && last ? encode(last.ts, last.id) : null,
    };
  }

  async record(dto: RecordSmsStockDto, actor: Actor): Promise<SmsStockEntryDto> {
    const tenantId = (await this.home.id()) ?? null;
    return this.ds.transaction(async (em) => {
      const repo = em.getRepository(SmsStockEntry);
      const saved = await repo.save(
        repo.create({
          bought_on: dto.boughtOn.slice(0, 10),
          sms_count: dto.smsCount,
          cost_paisa: String(toPaisa(dto.costTaka)),
          note: dto.note ? dto.note : null,
          entered_by_user_id: actor.userId,
        }),
      );
      await this.audit.record(
        {
          action: AuditAction.SMS_STOCK_RECORDED,
          entity_type: 'SmsStockEntry',
          entity_id: saved.id,
          tenant_id: tenantId,
          performed_by_user_id: actor.userId,
          ip_address: actor.ip ?? null,
          user_agent: actor.userAgent ?? null,
          new_values: { sms_count: saved.sms_count, cost_paisa: saved.cost_paisa },
        },
        em,
      );
      return {
        id: saved.id,
        boughtOn: saved.bought_on,
        smsCount: saved.sms_count,
        costPaisa: saved.cost_paisa,
        note: saved.note,
        createdAt: saved.created_at.toISOString(),
      };
    });
  }

  /** Soft delete. A row the report already counted is still deletable; the audit row keeps the reason. */
  async remove(id: string, reason: string, actor: Actor & { approverId?: string }): Promise<void> {
    const tenantId = (await this.home.id()) ?? null;
    await this.ds.transaction(async (em) => {
      const repo = em.getRepository(SmsStockEntry);
      const row = await repo.findOne({
        where: { id, deleted_at: IsNull() },
        lock: { mode: 'pessimistic_write' },
      });
      if (!row) throw new NotFoundException(NOT_FOUND);
      await repo.update(id, {
        deleted_at: new Date(),
        deleted_by_user_id: actor.userId,
        delete_reason: reason,
      });
      await this.audit.recordApproved(
        {
          action: AuditAction.SMS_STOCK_DELETED,
          entity_type: 'SmsStockEntry',
          entity_id: id,
          tenant_id: tenantId,
          performed_by_user_id: actor.userId,
          ip_address: actor.ip ?? null,
          user_agent: actor.userAgent ?? null,
          old_values: { sms_count: row.sms_count, cost_paisa: row.cost_paisa },
          new_values: { reason },
          approved_by_user_id: actor.approverId ?? actor.userId,
          approval_scope: ApprovalScope.PLATFORM_SMS_STOCK,
        },
        em,
      );
    });
  }

  async recordBalance(smsBalance: number, actor: Actor) {
    const tenantId = (await this.home.id()) ?? null;
    return this.ds.transaction(async (em) => {
      const repo = em.getRepository(SmsProviderBalanceReading);
      const saved = await repo.save(
        repo.create({ sms_balance: smsBalance, entered_by_user_id: actor.userId }),
      );
      await this.audit.record(
        {
          action: AuditAction.SMS_STOCK_RECORDED,
          entity_type: 'SmsStockEntry',
          entity_id: saved.id,
          tenant_id: tenantId,
          performed_by_user_id: actor.userId,
          ip_address: actor.ip ?? null,
          user_agent: actor.userAgent ?? null,
          new_values: {
            kind: 'provider_balance',
            reading_id: saved.id,
            sms_balance: saved.sms_balance,
          },
        },
        em,
      );
      return { sms: saved.sms_balance, asOf: saved.created_at.toISOString() };
    });
  }

  /** sum(cost) / sum(sms) over live entries, integer paisa, half up. Null when there are none. */
  async weightedAverageCostPaisaPerSms(): Promise<number | null> {
    const [row]: Array<{ avg: string | null }> = await this.ds.query(
      `SELECT FLOOR(SUM(cost_paisa)::numeric / NULLIF(SUM(sms_count), 0) + 0.5)::text AS avg
         FROM sms_stock_entries WHERE deleted_at IS NULL`,
    );
    return row?.avg == null ? null : Number(row.avg);
  }
}
