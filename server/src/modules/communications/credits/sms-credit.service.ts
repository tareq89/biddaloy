import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, QueryFailedError, Repository } from 'typeorm';
import { SchoolsService } from '../../schools/schools.service';
import { SmsCreditBalance } from './entities/sms-credit-balance.entity';
import {
  SmsCreditLedger,
  SmsCreditLedgerKind,
  SmsCreditLedgerReferenceType,
} from './entities/sms-credit-ledger.entity';

export interface CreditMovementOptions {
  reason?: string;
  actorUserId?: string;
  idempotencyKey: string;
}

export type SettleOutcome = 'DEBIT' | 'RELEASE';

export interface CreditBalance {
  available: number;
  reserved: number;
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
  constructor(
    @InjectRepository(SmsCreditBalance)
    private readonly balanceRepo: Repository<SmsCreditBalance>,
    @InjectRepository(SmsCreditLedger)
    private readonly ledgerRepo: Repository<SmsCreditLedger>,
    private readonly dataSource: DataSource,
    private readonly schoolsService: SchoolsService,
  ) {}

  /** `communications.sms.metering === 'PLATFORM'`. Absent/`OFF` (or no
   * `communications.sms` section at all) reads as unmetered. */
  async isMetered(tenantId: string): Promise<boolean> {
    const settings = await this.schoolsService.getResolvedSettings(tenantId);
    return settings.communications?.sms?.metering === 'PLATFORM';
  }

  async getBalance(tenantId: string): Promise<CreditBalance> {
    return this.readBalance(this.balanceRepo.manager, tenantId);
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
  ): Promise<CreditBalance> {
    return this.applyMovement(tenantId, SmsCreditLedgerKind.GRANT, units, units, opts);
  }

  /** Signed manual correction — `signedUnits` can be negative. A correction
   * that would drive `available` below 0 is rejected as a 400 (the DB
   * check constraint is the real guard; this just maps its error). */
  async adjust(
    tenantId: string,
    signedUnits: number,
    opts: CreditMovementOptions,
  ): Promise<CreditBalance> {
    return this.applyMovement(tenantId, SmsCreditLedgerKind.ADJUST, signedUnits, signedUnits, opts);
  }

  private async applyMovement(
    tenantId: string,
    kind: SmsCreditLedgerKind,
    ledgerUnits: number,
    availableDelta: number,
    opts: CreditMovementOptions,
  ): Promise<CreditBalance> {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const existing = await manager.findOne(SmsCreditLedger, {
          where: { tenant_id: tenantId, idempotency_key: opts.idempotencyKey },
        });
        if (existing) {
          return this.readBalance(manager, tenantId);
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

        await manager.query(
          `INSERT INTO "sms_credit_balance" (tenant_id, available, reserved, updated_at)
           VALUES ($1, GREATEST($2, 0), 0, now())
           ON CONFLICT (tenant_id) DO UPDATE
             SET available = "sms_credit_balance".available + $2, updated_at = now()`,
          [tenantId, availableDelta],
        );

        return this.readBalance(manager, tenantId);
      });
    } catch (err) {
      // Lost a race with a concurrent call carrying the same idempotency
      // key — that call's insert won, this one's transaction (balance
      // change included) rolled back automatically. Current balance is
      // the correct answer, no-op from this caller's point of view.
      if (isUniqueViolation(err)) {
        return this.getBalance(tenantId);
      }
      if (isCheckViolation(err)) {
        throw new BadRequestException(
          `Adjustment would drive the SMS credit balance for tenant "${tenantId}" below zero.`,
        );
      }
      throw err;
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

        // Postgres via the pg driver returns `[rows, affectedCount]` for a
        // parameterized RETURNING query, not just the row array — checking
        // `rows.length` (not the tuple's own length, which is always 2)
        // is what tells apart "0 rows matched" from "1 row updated".
        const [rows]: [Array<{ available: number }>, number] = await manager.query(
          `UPDATE "sms_credit_balance"
             SET available = available - $2, reserved = reserved + $2, updated_at = now()
             WHERE tenant_id = $1 AND available >= $2
             RETURNING available`,
          [tenantId, units],
        );
        if (rows.length === 0) {
          const balance = await this.readBalance(manager, tenantId);
          return { ok: false as const, available: balance.available };
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
      const reserveRow = await manager.findOne(SmsCreditLedger, {
        where: {
          tenant_id: tenantId,
          idempotency_key: idempotencyKey,
          kind: SmsCreditLedgerKind.RESERVE,
        },
        lock: { mode: 'pessimistic_write' },
      });
      if (!reserveRow) {
        throw new BadRequestException(
          `No RESERVE found for idempotency key "${idempotencyKey}" on tenant "${tenantId}".`,
        );
      }

      const alreadySettled = await manager.findOne(SmsCreditLedger, {
        where: { tenant_id: tenantId, idempotency_key: settleKey },
      });
      if (alreadySettled) {
        return;
      }

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
   * what's left reserved for the batch — the DB check constraint rejects
   * an over-settle; this maps that into a clear 400. */
  async settlePart(
    tenantId: string,
    batchKey: string,
    logKey: string,
    units: number,
    outcome: SettleOutcome,
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
          throw new BadRequestException(
            `No RESERVE found for batch key "${batchKey}" on tenant "${tenantId}".`,
          );
        }

        const alreadySettled = await manager.findOne(SmsCreditLedger, {
          where: { tenant_id: tenantId, idempotency_key: settleKey },
        });
        if (alreadySettled) {
          return;
        }

        await this.moveReservedUnits(manager, tenantId, units, outcome);
        await manager.insert(SmsCreditLedger, {
          tenant_id: tenantId,
          kind: outcome === 'DEBIT' ? SmsCreditLedgerKind.DEBIT : SmsCreditLedgerKind.RELEASE,
          units,
          reference_type: SmsCreditLedgerReferenceType.BATCH,
          reference_id: null,
          idempotency_key: settleKey,
        });
      });
    } catch (err) {
      if (isCheckViolation(err)) {
        throw new BadRequestException(
          `settlePart(${units}) would exceed the remaining reserved balance for batch "${batchKey}" on tenant "${tenantId}".`,
        );
      }
      throw err;
    }
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
