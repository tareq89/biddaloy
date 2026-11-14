import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import {
  CommunicationMedium,
  countSmsSegments,
  SmsLotSource,
  SmsLotStatus,
} from '@biddaloy/shared';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  In,
  LessThanOrEqual,
  MoreThan,
  QueryFailedError,
  Repository,
} from 'typeorm';
import { SchoolsService } from '../../schools/schools.service';
import { SmsCreditBalance } from './entities/sms-credit-balance.entity';
import { SmsCreditLot } from './entities/sms-credit-lot.entity';
import { SmsCreditLotDraw } from './entities/sms-credit-lot-draw.entity';
import { readSmsSource } from '../sms-source/sms-source.util';
import { planDraw, planReturn, sortByExpiry, usableSum } from './sms-credit-lot-plan';
import {
  SmsCreditLedger,
  SmsCreditLedgerKind,
  SmsCreditLedgerReferenceType,
} from './entities/sms-credit-ledger.entity';

export interface CreditMovementOptions {
  reason?: string;
  actorUserId?: string;
  idempotencyKey: string;
  /** [100.1.03] Expiry of the lot a `grant` creates. Default: never expires. */
  expiresAt?: Date | null;
  /** Runs inside the same transaction as the ledger/balance write, only
   * when this call actually applies a new movement (never on an
   * idempotency-key replay) — so a caller's side effect (e.g. an audit
   * row) commits or rolls back atomically with the movement it describes,
   * instead of possibly landing after a commit that a later crash never
   * lets it repair. */
  onApplied?: (manager: EntityManager) => Promise<void>;
}

export type SettleOutcome = 'DEBIT' | 'RELEASE';

export interface CreditBalance {
  available: number;
  reserved: number;
}

export interface CreditMovementResult extends CreditBalance {
  /** `false` when `idempotencyKey` had already been applied — the balance
   * is current, but no new ledger row was written on this call. Lets a
   * caller (e.g. `SmsCreditsService.grantOrAdjust`) skip auditing a replay
   * as if it were a second movement. */
  applied: boolean;
}

function pgErrorCode(err: unknown): string | undefined {
  return err instanceof QueryFailedError ? (err as unknown as { code?: string }).code : undefined;
}

/** Postgres 23505 — unique_violation. */
function isUniqueViolation(err: unknown): boolean {
  return pgErrorCode(err) === '23505';
}

/** Postgres 23514 — check_violation (the `available >= 0 AND reserved >= 0`
 * constraint on `sms_credit_balance`). */
function isCheckViolation(err: unknown): boolean {
  return pgErrorCode(err) === '23514';
}

const SETTLE_TOO_MANY =
  'Settling these units would exceed the remaining reserved SMS credit balance.';
const BELOW_ZERO = "Adjustment would drive this school's SMS credit balance below zero.";

const LOT_ORDER = {
  expires_at: { direction: 'ASC', nulls: 'LAST' },
  created_at: 'ASC',
  id: 'ASC',
} as const;

/** The Dhaka calendar day of `d` as YYYY-MM-DD (key of the once-a-day expiry row). */
function dhakaDate(d: Date): string {
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' });
}

/**
 * [15.6.3/#546] The only writer to `sms_credit_ledger`/`sms_credit_balance`
 * (epic #508 D6). One credit == one SMS segment, always an integer (D5) —
 * every `units` argument here is assumed already-counted via the shared
 * `countSmsSegments` helper (#544); this service just moves the numbers.
 *
 * Every mutating method is idempotent on its `idempotencyKey` (or, for
 * `settlePart`, `${logKey}:settle`) and tenant-scoped — callers never pass
 * raw SQL, only a `tenantId` plus plain values.
 */
@Injectable()
export class SmsCreditService {
  private readonly logger = new Logger(SmsCreditService.name);

  constructor(
    @InjectRepository(SmsCreditBalance)
    private readonly balanceRepo: Repository<SmsCreditBalance>,
    @InjectRepository(SmsCreditLedger)
    private readonly ledgerRepo: Repository<SmsCreditLedger>,
    private readonly dataSource: DataSource,
    private readonly schoolsService: SchoolsService,
  ) {}

  /** True when the school's SMS source is SchoolManagerP (`readSmsSource`: explicit `source`, else
   * derived from `metering`). Absent/`OFF` (or no `communications.sms` section) reads as unmetered. */
  async isMetered(tenantId: string): Promise<boolean> {
    const settings = await this.schoolsService.getResolvedSettings(tenantId);
    // One read of the source, shared with the provider resolver (Epic 100 D9).
    return readSmsSource(settings as unknown as Record<string, unknown>) === 'SCHOOLMANAGERP';
  }

  async getBalance(tenantId: string): Promise<CreditBalance> {
    return this.readBalance(this.balanceRepo.manager, tenantId);
  }

  /** Tenant-scoped, newest-first page of the ledger — backs #550's
   * `GET /communications/sms-credits`. */
  async listLedger(
    tenantId: string,
    page: number,
    limit: number,
  ): Promise<{ data: SmsCreditLedger[]; total: number }> {
    const [data, total] = await this.ledgerRepo.findAndCount({
      where: { tenant_id: tenantId },
      order: { created_at: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { data, total };
  }

  /** Balance + a page of ledger history, in the shape both
   * `GET /communications/sms-credits` (tenant-facing) and
   * `GET /schools/:id/sms-credits` (SUPER_ADMIN, cross-school) return —
   * they differ only in which `tenantId` the caller is allowed to pass. */
  async getCreditsSummary(
    tenantId: string,
    page: number,
    limit: number,
  ): Promise<{
    metering: 'OFF' | 'PLATFORM';
    available: number;
    reserved: number;
    ledger: {
      data: SmsCreditLedger[];
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    };
  }> {
    const metering = await this.isMetered(tenantId);
    if (!metering) {
      // Contract: OFF always returns the zeroed shape, never a stale
      // balance/ledger a tenant accrued before metering was switched off.
      return {
        metering: 'OFF',
        available: 0,
        reserved: 0,
        ledger: { data: [], total: 0, page, limit, totalPages: 1 },
      };
    }

    const [balance, { data, total }] = await Promise.all([
      this.getBalance(tenantId),
      this.listLedger(tenantId, page, limit),
    ]);

    return {
      metering: 'PLATFORM',
      available: balance.available,
      reserved: balance.reserved,
      ledger: {
        data,
        total,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  private async readBalance(manager: EntityManager, tenantId: string): Promise<CreditBalance> {
    const row = await manager.findOne(SmsCreditBalance, { where: { tenant_id: tenantId } });
    return { available: row?.available ?? 0, reserved: row?.reserved ?? 0 };
  }

  /** Adds `units` (always positive) to `available`. Idempotent: a repeat
   * `idempotencyKey` is a no-op that just returns the current balance. */
  async grant(
    tenantId: string,
    units: number,
    opts: CreditMovementOptions,
  ): Promise<CreditMovementResult> {
    return this.applyMovement(tenantId, SmsCreditLedgerKind.GRANT, units, opts);
  }

  /** Signed manual correction — `signedUnits` can be negative. A correction
   * that would drive `available` below 0 is rejected as a 400 (the DB
   * check constraint is the real guard; this just maps its error). */
  async adjust(
    tenantId: string,
    signedUnits: number,
    opts: CreditMovementOptions,
  ): Promise<CreditMovementResult> {
    return this.applyMovement(tenantId, SmsCreditLedgerKind.ADJUST, signedUnits, opts);
  }

  private async applyMovement(
    tenantId: string,
    kind: SmsCreditLedgerKind,
    ledgerUnits: number,
    opts: CreditMovementOptions,
  ): Promise<CreditMovementResult> {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const existing = await manager.findOne(SmsCreditLedger, {
          where: { tenant_id: tenantId, idempotency_key: opts.idempotencyKey },
        });
        if (existing) {
          return { ...(await this.readBalance(manager, tenantId)), applied: false };
        }

        await manager.insert(SmsCreditLedger, {
          tenant_id: tenantId,
          kind,
          units: ledgerUnits,
          reference_type: SmsCreditLedgerReferenceType.MANUAL,
          reference_id: null,
          idempotency_key: opts.idempotencyKey,
          reason: opts.reason ?? null,
          actor_user_id: opts.actorUserId ?? null,
        });

        if (ledgerUnits > 0) {
          await this.addCredit(manager, tenantId, ledgerUnits);
          await this.insertLot(
            manager,
            tenantId,
            SmsLotSource.MANUAL,
            ledgerUnits,
            opts.expiresAt ?? null,
          );
        } else {
          await this.takeFromLots(manager, tenantId, -ledgerUnits);
        }

        await opts.onApplied?.(manager);

        return { ...(await this.readBalance(manager, tenantId)), applied: true };
      });
    } catch (err) {
      // Lost a race with a concurrent call carrying the same idempotency
      // key — that call's insert won, this one's transaction (balance
      // change included) rolled back automatically. Current balance is
      // the correct answer, no-op from this caller's point of view.
      if (isUniqueViolation(err)) {
        return { ...(await this.getBalance(tenantId)), applied: false };
      }
      if (isCheckViolation(err)) {
        throw new BadRequestException(BELOW_ZERO);
      }
      throw err;
    }
  }

  /** [#2216] Reserve under the shared `batch:<batchId>` key (#1317) only when
   * the tenant is metered. Producers that queue SMS call this once per
   * message/batch so no metered SMS reaches a gateway unreserved. */
  async reserveIfMetered(
    tenantId: string,
    units: number,
    batchId: string,
  ): Promise<'UNMETERED' | 'RESERVED' | { insufficient: true; available: number }> {
    if (!(await this.isMetered(tenantId))) return 'UNMETERED';
    const res = await this.reserve(tenantId, units, `batch:${batchId}`, {
      type: 'batch',
      id: batchId,
    });
    return res.ok ? 'RESERVED' : { insufficient: true, available: res.available };
  }

  /** [#2216] For automated one-log-at-a-time producers (absence, homework,
   * admission): returns the extra job data to queue with (`{}` when the log is
   * not SMS or the tenant is unmetered) or `'INSUFFICIENT'` when credit is short.
   * The batch key is the log id, so a retried call is idempotent. */
  async reserveForLog(
    tenantId: string,
    log: { id: string; medium: string; message_body: string },
  ): Promise<{ batchId?: string; segments?: number } | 'INSUFFICIENT'> {
    if (log.medium !== CommunicationMedium.SMS) return {};
    const segments = countSmsSegments(log.message_body).segments;
    const outcome = await this.reserveIfMetered(tenantId, segments, log.id);
    if (outcome === 'UNMETERED') return {};
    if (outcome === 'RESERVED') return { batchId: log.id, segments };
    return 'INSUFFICIENT';
  }

  /** [#2216] Give back a `reserveForLog` reservation when its job was never
   * queued. Never throws: the caller is already handling a failure. */
  async releaseForLog(
    tenantId: string,
    logId: string,
    segments: number,
    batchId: string = logId,
  ): Promise<void> {
    try {
      await this.settlePart(tenantId, `batch:${batchId}`, `log:${logId}`, segments, 'RELEASE');
    } catch (err) {
      this.logger.error({
        msg: 'sms credit release on enqueue failure failed — reservation left stranded',
        communication_log_id: logId,
        tenant_id: tenantId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** Atomically moves `units` from `available` to `reserved`. Duplicate
   * `idempotencyKey` returns `{ ok: true }` without touching the balance —
   * it's already reserved. */
  async reserve(
    tenantId: string,
    units: number,
    idempotencyKey: string,
    reference?: { type: 'batch' | 'log' | 'manual'; id: string | null },
  ): Promise<{ ok: true } | { ok: false; available: number }> {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const existing = await manager.findOne(SmsCreditLedger, {
          where: { tenant_id: tenantId, idempotency_key: idempotencyKey },
        });
        if (existing) {
          return { ok: true as const };
        }

        // Lock order: the balance row first, then the lots (D30).
        await this.lockBalance(manager, tenantId);
        const now = new Date();
        const lots = await this.loadLots(manager, tenantId, { remaining: MoreThan(0) });
        const plan = planDraw(lots, units, now);
        if (!plan) {
          return { ok: false as const, available: usableSum(lots, now) };
        }
        for (const part of plan) {
          await this.moveLot(
            manager,
            tenantId,
            part.lotId,
            { remaining: -part.units, reserved: part.units },
            now,
          );
          await manager.insert(SmsCreditLotDraw, {
            tenant_id: tenantId,
            lot_id: part.lotId,
            reserve_key: idempotencyKey,
            units: part.units,
            open_units: part.units,
          });
        }
        // Postgres via the pg driver returns `[rows, affectedCount]` for a
        // parameterized RETURNING query; check `rows.length`.
        const [rows]: [Array<{ available: number }>, number] = await manager.query(
          `UPDATE "sms_credit_balance"
             SET available = available - $2, reserved = reserved + $2, updated_at = now()
             WHERE tenant_id = $1 AND available >= $2
             RETURNING available`,
          [tenantId, units],
        );
        if (rows.length === 0) {
          // The cache is lower than the lots: abort and roll everything back.
          throw new Error('SMS credit balance is out of step with its lots.');
        }

        await manager.insert(SmsCreditLedger, {
          tenant_id: tenantId,
          kind: SmsCreditLedgerKind.RESERVE,
          units,
          reference_type:
            reference?.type === 'batch'
              ? SmsCreditLedgerReferenceType.BATCH
              : reference?.type === 'log'
                ? SmsCreditLedgerReferenceType.LOG
                : SmsCreditLedgerReferenceType.MANUAL,
          reference_id: reference?.id ?? null,
          idempotency_key: idempotencyKey,
        });
        return { ok: true as const };
      });
    } catch (err) {
      // Same race as applyMovement: another call with this exact key won
      // the ledger insert first, so this one's balance UPDATE was rolled
      // back with the rest of its transaction — already reserved.
      if (isUniqueViolation(err)) {
        return { ok: true as const };
      }
      throw err;
    }
  }

  /** Settles a whole reservation exactly once. `DEBIT` consumes the
   * reserved units; `RELEASE` returns them to `available`. A second call
   * with the same `idempotencyKey` is a no-op. */
  async settle(tenantId: string, idempotencyKey: string, outcome: SettleOutcome): Promise<void> {
    const settleKey = `${idempotencyKey}:settle`;
    await this.dataSource.transaction(async (manager) => {
      // Lock order: this reserve row is locked before the balance row (settleDraws). Safe:
      // only settle paths lock a reserve row, and no path holds the balance lock while waiting
      // for one, so there is no cycle. Same in settlePart.
      const reserveRow = await manager.findOne(SmsCreditLedger, {
        where: {
          tenant_id: tenantId,
          idempotency_key: idempotencyKey,
          kind: SmsCreditLedgerKind.RESERVE,
        },
        lock: { mode: 'pessimistic_write' },
      });
      if (!reserveRow) {
        throw new BadRequestException('No matching SMS credit reservation was found.');
      }

      const alreadySettled = await manager.findOne(SmsCreditLedger, {
        where: { tenant_id: tenantId, idempotency_key: settleKey },
      });
      if (alreadySettled) {
        return;
      }

      await this.settleDraws(manager, tenantId, idempotencyKey, reserveRow.units, outcome);
      await this.moveReservedUnits(manager, tenantId, reserveRow.units, outcome);
      await manager.insert(SmsCreditLedger, {
        tenant_id: tenantId,
        kind: outcome === 'DEBIT' ? SmsCreditLedgerKind.DEBIT : SmsCreditLedgerKind.RELEASE,
        units: reserveRow.units,
        reference_type: SmsCreditLedgerReferenceType.MANUAL,
        reference_id: null,
        idempotency_key: settleKey,
      });
    });
  }

  /** Peels `units` off a batch reservation (identified by `batchKey`, the
   * idempotency key its `reserve` call used) under a per-log idempotency
   * key `${logKey}:settle`. Used by #549 to settle one SMS at a time out
   * of a bulk-reminder batch's single reservation. `units` cannot exceed
   * what's left reserved *for this batch* — the DB check constraint only
   * guards the tenant-wide `reserved` total, which stays non-negative even
   * if this settlement dips into a different batch's reservation, so the
   * batch-level cap below is enforced explicitly: it sums this batch's own
   * prior DEBIT/RELEASE rows (found via `reference_id`, set to the same
   * batch id `reserve` recorded on the RESERVE row) and rejects when that
   * sum plus `units` would exceed the RESERVE row's own `units`. The
   * pessimistic lock on the RESERVE row below serializes concurrent
   * `settlePart` calls for the same batch, so this sum is read
   * consistently without a separate lock of its own. */
  async settlePart(
    tenantId: string,
    batchKey: string,
    logKey: string,
    units: number,
    outcome: SettleOutcome,
    reason?: string,
  ): Promise<void> {
    const settleKey = `${logKey}:settle`;
    try {
      await this.dataSource.transaction(async (manager) => {
        const reserveRow = await manager.findOne(SmsCreditLedger, {
          where: {
            tenant_id: tenantId,
            idempotency_key: batchKey,
            kind: SmsCreditLedgerKind.RESERVE,
          },
          lock: { mode: 'pessimistic_write' },
        });
        if (!reserveRow) {
          throw new BadRequestException('No matching SMS credit reservation was found.');
        }

        const alreadySettled = await manager.findOne(SmsCreditLedger, {
          where: { tenant_id: tenantId, idempotency_key: settleKey },
        });
        if (alreadySettled) {
          return;
        }

        // `reference_id` is only populated when `reserve` was called with a
        // reference (every batch reservation is) — this check is skipped
        // for the rare/legacy reservation with none, since there is then
        // nothing to scope the sum to.
        if (reserveRow.reference_id !== null) {
          const priorSettlements = await manager.find(SmsCreditLedger, {
            where: {
              tenant_id: tenantId,
              reference_type: SmsCreditLedgerReferenceType.BATCH,
              reference_id: reserveRow.reference_id,
              kind: In([SmsCreditLedgerKind.DEBIT, SmsCreditLedgerKind.RELEASE]),
            },
          });
          const alreadySettledUnits = priorSettlements.reduce((sum, row) => sum + row.units, 0);
          if (alreadySettledUnits + units > reserveRow.units) {
            throw new BadRequestException(SETTLE_TOO_MANY);
          }
        }

        await this.settleDraws(manager, tenantId, batchKey, units, outcome);
        await this.moveReservedUnits(manager, tenantId, units, outcome);
        await manager.insert(SmsCreditLedger, {
          tenant_id: tenantId,
          kind: outcome === 'DEBIT' ? SmsCreditLedgerKind.DEBIT : SmsCreditLedgerKind.RELEASE,
          units,
          reference_type: SmsCreditLedgerReferenceType.BATCH,
          reference_id: reserveRow.reference_id,
          idempotency_key: settleKey,
          reason: reason ?? null,
        });
      });
    } catch (err) {
      if (isCheckViolation(err)) {
        throw new BadRequestException(SETTLE_TOO_MANY);
      }
      throw err;
    }
  }

  /**
   * Gives the credit of one message back to `available`, inside the caller's transaction so it
   * commits or rolls back with the status change that earned it (Check status, a vendor that does
   * not bill failed SMS). Once per message: the idempotency key is the log id, so a repeat is a
   * no-op. Whole units only (Rule 26).
   */
  async refundForLog(
    manager: EntityManager,
    tenantId: string,
    logId: string,
    units: number,
  ): Promise<void> {
    if (!Number.isInteger(units) || units <= 0) return;
    const key = `log:${logId}:refund`;
    const done = await manager.findOne(SmsCreditLedger, {
      where: { tenant_id: tenantId, idempotency_key: key },
    });
    if (done) return;
    await manager.insert(SmsCreditLedger, {
      tenant_id: tenantId,
      kind: SmsCreditLedgerKind.GRANT,
      units,
      reference_type: SmsCreditLedgerReferenceType.LOG,
      reference_id: logId,
      idempotency_key: key,
      reason: 'Vendor reported the SMS failed; credit given back',
    });
    await this.addCredit(manager, tenantId, units);
    const now = new Date();
    const lots = await this.loadLots(manager, tenantId, {
      debited_units: MoreThan(0),
      status: In([SmsLotStatus.ACTIVE, SmsLotStatus.USED_UP]),
    });
    const { parts, leftover } = planReturn(lots, units);
    for (const part of parts) {
      await this.moveLot(
        manager,
        tenantId,
        part.lotId,
        { remaining: part.units, debited: -part.units },
        now,
      );
    }
    // Legacy gap: no lot has debited units to take it back.
    if (leftover > 0) await this.insertLot(manager, tenantId, SmsLotSource.MANUAL, leftover, null);
  }

  /** [100.1.03] A paid bundle: one PURCHASE row, one BUNDLE lot, `available += units`.
   * Idempotent per key. With `opts.manager` it joins the caller's transaction. The caller
   * guarantees that `bundleOrderId` belongs to `tenantId`. */
  async purchase(
    tenantId: string,
    input: {
      bundleOrderId: string;
      units: number;
      expiresAt: Date | null;
      idempotencyKey: string;
      reason?: string;
    },
    opts?: { manager?: EntityManager },
  ): Promise<CreditBalance> {
    const run = async (manager: EntityManager): Promise<CreditBalance> => {
      if (!Number.isInteger(input.units) || input.units <= 0) {
        throw new BadRequestException('Bundle units must be a positive whole number.');
      }
      // Balance row first (upsert of 0 creates and locks it), then the key is re-checked under
      // the lock. The ledger insert ignores a conflict, so a repeat never raises a unique
      // violation that would abort a caller's transaction.
      await this.addCredit(manager, tenantId, 0);
      const inserted = await manager
        .createQueryBuilder()
        .insert()
        .into(SmsCreditLedger)
        .values({
          tenant_id: tenantId,
          kind: SmsCreditLedgerKind.PURCHASE,
          units: input.units,
          reference_type: SmsCreditLedgerReferenceType.BUNDLE_ORDER,
          reference_id: input.bundleOrderId,
          idempotency_key: input.idempotencyKey,
          reason: input.reason ?? null,
        })
        .orIgnore()
        .returning('id')
        .execute();
      if (!inserted.raw?.length) return this.readBalance(manager, tenantId);
      await this.addCredit(manager, tenantId, input.units);
      await this.insertLot(
        manager,
        tenantId,
        SmsLotSource.BUNDLE,
        input.units,
        input.expiresAt,
        input.bundleOrderId,
      );
      return this.readBalance(manager, tenantId);
    };
    if (opts?.manager) return run(opts.manager);
    try {
      return await this.dataSource.transaction(run);
    } catch (err) {
      if (isUniqueViolation(err)) return this.getBalance(tenantId);
      throw err;
    }
  }

  /** [100.1.03] Writes off the unused units of lots past their expiry, one transaction per lot
   * (balance row first). Never touches reserved units. Repeat the same Dhaka day: no-op. */
  async expireDue(now: Date, opts?: { limit?: number }): Promise<{ lots: number; units: number }> {
    const due = await this.dataSource.manager.find(SmsCreditLot, {
      where: { expires_at: LessThanOrEqual(now), remaining: MoreThan(0) },
      order: { expires_at: 'ASC', id: 'ASC' },
      take: Math.min(Math.max(opts?.limit ?? 100, 1), 1000),
    });
    let lots = 0;
    let units = 0;
    for (const candidate of due) {
      let moved = 0;
      try {
        moved = await this.expireOne(candidate, now);
      } catch {
        // One bad lot must not stop the sweep; the next run retries it. Tenant id only.
        this.logger.error({ msg: 'sms credit lot expiry failed', tenant_id: candidate.tenant_id });
      }
      if (moved > 0) {
        lots += 1;
        units += moved;
      }
    }
    return { lots, units };
  }

  private expireOne(candidate: SmsCreditLot, now: Date): Promise<number> {
    {
      return this.dataSource.transaction(async (manager) => {
        await this.lockBalance(manager, candidate.tenant_id);
        const lot = await manager.findOne(SmsCreditLot, {
          where: { id: candidate.id, tenant_id: candidate.tenant_id },
          lock: { mode: 'pessimistic_write' },
        });
        if (!lot || lot.remaining <= 0 || !lot.expires_at || lot.expires_at > now) return 0;
        const key = `expire:${lot.id}:${dhakaDate(now)}`;
        const done = await manager.findOne(SmsCreditLedger, {
          where: { tenant_id: lot.tenant_id, idempotency_key: key },
        });
        if (done) return 0;
        const n = lot.remaining;
        await manager.insert(SmsCreditLedger, {
          tenant_id: lot.tenant_id,
          kind: SmsCreditLedgerKind.EXPIRE,
          units: n,
          reference_type: SmsCreditLedgerReferenceType.LOT,
          reference_id: lot.id,
          idempotency_key: key,
          reason: 'Unused credit expired',
        });
        await this.moveLot(manager, lot.tenant_id, lot.id, { remaining: -n, expired: n }, now);
        await manager.query(
          `UPDATE "sms_credit_balance" SET available = available - $2, updated_at = now() WHERE tenant_id = $1`,
          [lot.tenant_id, n],
        );
        return n;
      });
    }
  }

  /** [100.3.06] Refund of a package order: closes the bundle's lot only while nothing was ever
   * taken from it, inside the caller's transaction. Same lock order as `reserve` (balance row,
   * then lot), so a reserve that won the lock first makes this a 409 `BUNDLE_ALREADY_USED`.
   * The lot becomes REFUNDED (its units move to `expired_units`, which keeps the lot CHECK) and
   * the balance drops by them; the ledger row is an ADJUST with negative units, so the ledger
   * sum still equals the balance. Returns `closed:false` when the lot was already refunded. */
  async closeUntouchedLot(
    manager: EntityManager,
    tenantId: string,
    bundleOrderId: string,
  ): Promise<{ closed: boolean; units: number }> {
    await this.lockBalance(manager, tenantId);
    const lot = await manager.findOne(SmsCreditLot, {
      where: { tenant_id: tenantId, bundle_order_id: bundleOrderId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!lot) {
      throw new ConflictException({
        message: 'This package order has no credit to take back',
        details: { code: 'ORDER_NOT_REFUNDABLE' },
      });
    }
    if (lot.status === SmsLotStatus.REFUNDED) return { closed: false, units: 0 };
    const draws = await manager.count(SmsCreditLotDraw, {
      where: { tenant_id: tenantId, lot_id: lot.id },
    });
    const untouched =
      lot.status === SmsLotStatus.ACTIVE &&
      lot.remaining === lot.units_total &&
      lot.reserved_units === 0 &&
      lot.debited_units === 0 &&
      lot.expired_units === 0 &&
      draws === 0;
    if (!untouched) {
      throw new ConflictException({
        message: 'Some of this package was already used',
        details: { code: 'BUNDLE_ALREADY_USED' },
      });
    }
    await manager.insert(SmsCreditLedger, {
      tenant_id: tenantId,
      kind: SmsCreditLedgerKind.ADJUST,
      units: -lot.units_total,
      reference_type: SmsCreditLedgerReferenceType.LOT,
      reference_id: lot.id,
      idempotency_key: `refund:${bundleOrderId}`,
      reason: 'Package refunded',
    });
    await manager.query(
      `UPDATE "sms_credit_lots"
          SET status = 'REFUNDED', expired_units = expired_units + remaining, remaining = 0
        WHERE id = $1 AND tenant_id = $2`,
      [lot.id, tenantId],
    );
    await manager.query(
      `UPDATE "sms_credit_balance" SET available = available - $2, updated_at = now() WHERE tenant_id = $1`,
      [tenantId, lot.units_total],
    );
    return { closed: true, units: lot.units_total };
  }

  /** [100.3.06] Read-only: per package order, units used (reserved + debited), the lot expiry and
   * whether every unit is still there (the refund test). Orders with no lot are absent. */
  async bundleLotUsage(
    bundleOrderIds: string[],
  ): Promise<Map<string, { used: number; untouched: boolean; expiresAt: Date | null }>> {
    if (bundleOrderIds.length === 0) return new Map();
    const rows: {
      bundle_order_id: string;
      used: number;
      untouched: boolean;
      expires_at: Date | null;
    }[] = await this.dataSource.query(
      `SELECT l.bundle_order_id, (l.reserved_units + l.debited_units)::int AS used, l.expires_at,
              (l.status = 'ACTIVE' AND l.remaining = l.units_total AND l.reserved_units = 0
               AND l.debited_units = 0 AND l.expired_units = 0
               AND NOT EXISTS (SELECT 1 FROM "sms_credit_lot_draws" d WHERE d.lot_id = l.id)) AS untouched
         FROM "sms_credit_lots" l WHERE l.bundle_order_id = ANY($1::uuid[])`,
      [bundleOrderIds],
    );
    return new Map(
      rows.map((r) => [
        r.bundle_order_id,
        { used: r.used, untouched: r.untouched, expiresAt: r.expires_at },
      ]),
    );
  }

  /** [100.1.03] Repair: the balance row becomes the sum of the lots. Not a movement, so no
   * ledger row. `_reason` is the caller's to record; it is not logged here. */
  async rebuildBalanceFromLots(
    tenantId: string,
    _reason: string,
  ): Promise<{ before: CreditBalance; after: CreditBalance }> {
    return this.dataSource.transaction(async (manager) => {
      await manager.query(
        `INSERT INTO "sms_credit_balance" (tenant_id, available, reserved, updated_at)
         VALUES ($1, 0, 0, now()) ON CONFLICT (tenant_id) DO NOTHING`,
        [tenantId],
      );
      await this.lockBalance(manager, tenantId);
      const before = await this.readBalance(manager, tenantId);
      const lots = await this.loadLots(manager, tenantId, {});
      const after = {
        available: lots.reduce((sum, l) => sum + l.remaining, 0),
        reserved: lots.reduce((sum, l) => sum + l.reserved_units, 0),
      };
      await manager.query(
        `UPDATE "sms_credit_balance" SET available = $2, reserved = $3, updated_at = now() WHERE tenant_id = $1`,
        [tenantId, after.available, after.reserved],
      );
      this.logger.log({
        msg: 'sms credit balance rebuilt from lots',
        tenant_id: tenantId,
        before,
        after,
      });
      return { before, after };
    });
  }

  // ---- lot helpers (every lot/draw access goes through the caller's manager) ----

  private async lockBalance(manager: EntityManager, tenantId: string): Promise<void> {
    await manager.findOne(SmsCreditBalance, {
      where: { tenant_id: tenantId },
      lock: { mode: 'pessimistic_write' },
    });
  }

  /** Upserts `available += units` (also takes the balance row lock). */
  private async addCredit(manager: EntityManager, tenantId: string, units: number): Promise<void> {
    await manager.query(
      `INSERT INTO "sms_credit_balance" (tenant_id, available, reserved, updated_at)
       VALUES ($1, $2, 0, now())
       ON CONFLICT (tenant_id) DO UPDATE
         SET available = "sms_credit_balance".available + $2, updated_at = now()`,
      [tenantId, units],
    );
  }

  /** Tenant-scoped, locked, in draw order. The tenant filter is what ties draws to lots. */
  private loadLots(
    manager: EntityManager,
    tenantId: string,
    extra: Record<string, unknown>,
  ): Promise<SmsCreditLot[]> {
    return manager.find(SmsCreditLot, {
      where: { tenant_id: tenantId, ...extra },
      order: LOT_ORDER,
      lock: { mode: 'pessimistic_write' },
    });
  }

  private async insertLot(
    manager: EntityManager,
    tenantId: string,
    source: SmsLotSource,
    units: number,
    expiresAt: Date | null,
    bundleOrderId: string | null = null,
  ): Promise<void> {
    await manager.insert(SmsCreditLot, {
      tenant_id: tenantId,
      source,
      bundle_order_id: bundleOrderId,
      units_total: units,
      remaining: units,
      expires_at: expiresAt,
      status: SmsLotStatus.ACTIVE,
    });
  }

  /** Moves counters and sets `status` in one statement: out of units -> USED_UP (EXPIRED when
   * past expiry), otherwise ACTIVE. */
  private async moveLot(
    manager: EntityManager,
    tenantId: string,
    lotId: string,
    d: { remaining?: number; reserved?: number; debited?: number; expired?: number },
    now: Date,
  ): Promise<void> {
    await manager.query(
      `UPDATE "sms_credit_lots"
          SET remaining = remaining + $3, reserved_units = reserved_units + $4,
              debited_units = debited_units + $5, expired_units = expired_units + $6,
              status = CASE WHEN remaining + $3 = 0 AND reserved_units + $4 = 0
                            THEN CASE WHEN expires_at IS NOT NULL AND expires_at <= $7 THEN 'EXPIRED' ELSE 'USED_UP' END
                            ELSE 'ACTIVE' END,
              updated_at = now()
        WHERE id = $1 AND tenant_id = $2`,
      [lotId, tenantId, d.remaining ?? 0, d.reserved ?? 0, d.debited ?? 0, d.expired ?? 0, now],
    );
  }

  /** Negative adjust: `units` out of usable lots (earliest expiry first), counted as debited. */
  private async takeFromLots(
    manager: EntityManager,
    tenantId: string,
    units: number,
  ): Promise<void> {
    await this.lockBalance(manager, tenantId);
    const now = new Date();
    const lots = await this.loadLots(manager, tenantId, { remaining: MoreThan(0) });
    const plan = planDraw(lots, units, now);
    if (!plan) throw new BadRequestException(BELOW_ZERO);
    for (const part of plan) {
      await this.moveLot(
        manager,
        tenantId,
        part.lotId,
        { remaining: -part.units, debited: part.units },
        now,
      );
    }
    await manager.query(
      `UPDATE "sms_credit_balance" SET available = available - $2, updated_at = now() WHERE tenant_id = $1`,
      [tenantId, units],
    );
  }

  /** Applies a settlement to the draws of `key` (or the tenant's `legacy:` draw when the key has
   * none), lowest expiry first. Throws the existing 400 when they hold fewer open units. */
  private async settleDraws(
    manager: EntityManager,
    tenantId: string,
    key: string,
    units: number,
    outcome: SettleOutcome,
  ): Promise<void> {
    // The balance row lock already queues every writer of this school; the UPDATEs below
    // take the lot row locks.
    await this.lockBalance(manager, tenantId);
    let draws = await manager.findBy(SmsCreditLotDraw, {
      tenant_id: tenantId,
      reserve_key: key,
    });
    if (draws.length === 0) {
      draws = await manager.findBy(SmsCreditLotDraw, {
        tenant_id: tenantId,
        reserve_key: `legacy:${tenantId}`,
      });
    }
    const lots = await manager.findBy(SmsCreditLot, {
      tenant_id: tenantId,
      id: In(draws.map((d) => d.lot_id)),
    });
    const now = new Date();
    const byLot = new Map(draws.map((d) => [d.lot_id, d]));
    let need = units;
    for (const lot of sortByExpiry(lots)) {
      const draw = byLot.get(lot.id);
      if (need === 0 || !draw || draw.open_units <= 0) continue;
      const take = Math.min(draw.open_units, need);
      await manager.query(
        `UPDATE "sms_credit_lot_draws" SET open_units = open_units - $3 WHERE id = $1 AND tenant_id = $2`,
        [draw.id, tenantId, take],
      );
      await this.moveLot(
        manager,
        tenantId,
        lot.id,
        outcome === 'DEBIT'
          ? { reserved: -take, debited: take }
          : { reserved: -take, remaining: take },
        now,
      );
      need -= take;
    }
    if (need > 0) throw new BadRequestException(SETTLE_TOO_MANY);
  }

  private async moveReservedUnits(
    manager: EntityManager,
    tenantId: string,
    units: number,
    outcome: SettleOutcome,
  ): Promise<void> {
    if (outcome === 'DEBIT') {
      await manager.query(
        `UPDATE "sms_credit_balance" SET reserved = reserved - $2, updated_at = now() WHERE tenant_id = $1`,
        [tenantId, units],
      );
    } else {
      await manager.query(
        `UPDATE "sms_credit_balance"
           SET reserved = reserved - $2, available = available + $2, updated_at = now()
           WHERE tenant_id = $1`,
        [tenantId, units],
      );
    }
  }
}
