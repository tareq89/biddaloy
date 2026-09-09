import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { SmsCreditService } from './sms-credit.service';
import { SmsCreditLedgerKind } from './entities/sms-credit-ledger.entity';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';

function uniqueViolation(): QueryFailedError {
  const err = new QueryFailedError('insert', [], new Error('duplicate key'));
  (err as unknown as { code?: string }).code = '23505';
  return err;
}

function checkViolation(): QueryFailedError {
  const err = new QueryFailedError('update', [], new Error('check constraint'));
  (err as unknown as { code?: string }).code = '23514';
  return err;
}

describe('SmsCreditService', () => {
  let balanceRepo: any;
  let ledgerRepo: any;
  let manager: any;
  let dataSource: any;
  let schoolsService: any;
  let service: SmsCreditService;

  // What manager.findOne(SmsCreditLedger, ...) and manager.query(...)
  // return — set per-test.
  let ledgerFindOneResult: unknown | null;
  let ledgerFindOneQueue: unknown[] | null;
  let balanceQueryResult: unknown[];
  let balanceRow: { available: number; reserved: number } | null;

  beforeEach(() => {
    ledgerFindOneResult = null;
    ledgerFindOneQueue = null;
    balanceQueryResult = [[{ available: 90 }], 1];
    balanceRow = { available: 90, reserved: 10 };

    balanceRepo = {
      manager: {
        findOne: vi.fn(async () => balanceRow),
      },
    };
    ledgerRepo = {};

    manager = {
      findOne: vi.fn(async (entity: any) => {
        // The transaction manager fields two kinds of findOne calls: a
        // ledger idempotency/lock lookup (queued per test) and a balance
        // re-read (used only on the insufficient-balance path) — told
        // apart by the entity class name so each test only has to stage
        // the ledger side.
        if (entity?.name === 'SmsCreditBalance') {
          return balanceRow;
        }
        if (ledgerFindOneQueue) {
          return ledgerFindOneQueue.shift() ?? null;
        }
        return ledgerFindOneResult;
      }),
      insert: vi.fn(async () => ({})),
      query: vi.fn(async () => balanceQueryResult),
    };

    dataSource = {
      transaction: vi.fn(async (cb: (m: any) => Promise<unknown>) => cb(manager)),
    };

    schoolsService = {
      getResolvedSettings: vi.fn(),
    };

    service = new SmsCreditService(balanceRepo, ledgerRepo, dataSource, schoolsService);
  });

  describe('reserve', () => {
    it('reserves units and inserts a RESERVE ledger row on first call', async () => {
      ledgerFindOneQueue = [null]; // no existing ledger row for this key
      manager.query = vi.fn(async () => [[{ available: 90 }], 1]);

      const result = await service.reserve(TENANT_ID, 10, 'reserve-key-1');

      expect(result).toEqual({ ok: true });
      expect(manager.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE "sms_credit_balance"'),
        [TENANT_ID, 10],
      );
      expect(manager.insert).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ kind: SmsCreditLedgerKind.RESERVE, units: 10 }),
      );
    });

    it('is idempotent: a repeat idempotency key returns ok without touching the balance', async () => {
      ledgerFindOneQueue = [{ id: 'existing-ledger-row' }];

      const result = await service.reserve(TENANT_ID, 10, 'reserve-key-1');

      expect(result).toEqual({ ok: true });
      expect(manager.query).not.toHaveBeenCalled();
      expect(manager.insert).not.toHaveBeenCalled();
    });

    it('is idempotent under a race: a unique-violation from a concurrent winner still returns ok', async () => {
      ledgerFindOneQueue = [null];
      dataSource.transaction = vi.fn(async () => {
        throw uniqueViolation();
      });

      const result = await service.reserve(TENANT_ID, 10, 'reserve-key-1');

      expect(result).toEqual({ ok: true });
    });

    it('returns { ok: false, available } when the balance is insufficient', async () => {
      ledgerFindOneQueue = [null];
      manager.query = vi.fn(async () => [[], 0]); // UPDATE matched 0 rows
      balanceRow = { available: 5, reserved: 0 };

      const result = await service.reserve(TENANT_ID, 10, 'reserve-key-1');

      expect(result).toEqual({ ok: false, available: 5 });
      expect(manager.insert).not.toHaveBeenCalled();
    });

    it('defaults to a MANUAL/null reference when none is passed', async () => {
      ledgerFindOneQueue = [null];
      manager.query = vi.fn(async () => [[{ available: 90 }], 1]);

      await service.reserve(TENANT_ID, 10, 'reserve-key-1');

      expect(manager.insert).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ reference_type: 'manual', reference_id: null }),
      );
    });

    it('records the given batch reference on the RESERVE row', async () => {
      ledgerFindOneQueue = [null];
      manager.query = vi.fn(async () => [[{ available: 90 }], 1]);

      await service.reserve(TENANT_ID, 10, 'batch:batch-1', {
        type: 'batch',
        id: 'batch-1',
      });

      expect(manager.insert).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ reference_type: 'batch', reference_id: 'batch-1' }),
      );
    });
  });

  describe('settle', () => {
    it('debits reserved units and inserts a DEBIT row on first call', async () => {
      ledgerFindOneQueue = [{ id: 'reserve-row', units: 10 }, null];

      await service.settle(TENANT_ID, 'reserve-key-1', 'DEBIT');

      expect(manager.query).toHaveBeenCalledWith(
        expect.stringContaining('reserved = reserved - $2'),
        [TENANT_ID, 10],
      );
      expect(manager.insert).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          kind: SmsCreditLedgerKind.DEBIT,
          units: 10,
          idempotency_key: 'reserve-key-1:settle',
        }),
      );
    });

    it('is a no-op on the second call with the same key', async () => {
      ledgerFindOneQueue = [{ id: 'reserve-row', units: 10 }, { id: 'already-settled' }];

      await service.settle(TENANT_ID, 'reserve-key-1', 'DEBIT');

      expect(manager.query).not.toHaveBeenCalled();
      expect(manager.insert).not.toHaveBeenCalled();
    });

    it('throws when no RESERVE row exists for the key', async () => {
      ledgerFindOneQueue = [null];

      await expect(service.settle(TENANT_ID, 'missing-key', 'DEBIT')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('grant / adjust', () => {
    it('grant inserts a GRANT row and upserts available', async () => {
      ledgerFindOneQueue = [null];

      const result = await service.grant(TENANT_ID, 100, { idempotencyKey: 'grant-key-1' });

      expect(manager.insert).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ kind: SmsCreditLedgerKind.GRANT, units: 100 }),
      );
      expect(manager.query).toHaveBeenCalledWith(expect.stringContaining('ON CONFLICT'), [
        TENANT_ID,
        100,
      ]);
      // The insert should not clamp a negative delta — otherwise adjust()
      // could silently succeed instead of hitting the check constraint.
      expect(manager.query).not.toHaveBeenCalledWith(expect.stringContaining('GREATEST'), [
        TENANT_ID,
        100,
      ]);
      expect(result.applied).toBe(true);
    });

    it('grant is a no-op on a repeat idempotency key', async () => {
      ledgerFindOneQueue = [{ id: 'existing' }];

      const result = await service.grant(TENANT_ID, 100, { idempotencyKey: 'grant-key-1' });

      expect(manager.insert).not.toHaveBeenCalled();
      expect(manager.query).not.toHaveBeenCalled();
      expect(result.applied).toBe(false);
    });

    it('adjust below zero maps the DB check violation to a 400', async () => {
      ledgerFindOneQueue = [null];
      dataSource.transaction = vi.fn(async () => {
        throw checkViolation();
      });

      await expect(
        service.adjust(TENANT_ID, -1000, { idempotencyKey: 'adjust-key-1' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getBalance', () => {
    it('returns zeros when no balance row exists', async () => {
      balanceRow = null;

      const result = await service.getBalance(TENANT_ID);

      expect(result).toEqual({ available: 0, reserved: 0 });
    });

    it('returns the stored row when one exists', async () => {
      balanceRow = { available: 42, reserved: 8 };

      const result = await service.getBalance(TENANT_ID);

      expect(result).toEqual({ available: 42, reserved: 8 });
    });
  });

  describe('isMetered', () => {
    it('true when communications.sms.metering is PLATFORM', async () => {
      schoolsService.getResolvedSettings.mockResolvedValue({
        communications: { sms: { provider: 'greenweb', metering: 'PLATFORM' } },
      });

      expect(await service.isMetered(TENANT_ID)).toBe(true);
    });

    it('false when metering is OFF', async () => {
      schoolsService.getResolvedSettings.mockResolvedValue({
        communications: { sms: { provider: 'greenweb', metering: 'OFF' } },
      });

      expect(await service.isMetered(TENANT_ID)).toBe(false);
    });

    it('false when no communications.sms section is set at all', async () => {
      schoolsService.getResolvedSettings.mockResolvedValue({});

      expect(await service.isMetered(TENANT_ID)).toBe(false);
    });
  });

  describe('listLedger', () => {
    it('scopes to the tenant, newest first, with paging applied', async () => {
      const rows = [{ id: 'ledger-1' }, { id: 'ledger-2' }];
      ledgerRepo.findAndCount = vi.fn(async () => [rows, 2]);

      const result = await service.listLedger(TENANT_ID, 2, 10);

      expect(ledgerRepo.findAndCount).toHaveBeenCalledWith({
        where: { tenant_id: TENANT_ID },
        order: { created_at: 'DESC' },
        skip: 10,
        take: 10,
      });
      expect(result).toEqual({ data: rows, total: 2 });
    });
  });

  describe('getCreditsSummary', () => {
    it('combines metering, balance, and a mapped ledger page for the given tenantId', async () => {
      schoolsService.getResolvedSettings.mockResolvedValue({
        communications: { sms: { metering: 'PLATFORM' } },
      });
      balanceRow = { available: 120, reserved: 5 };
      const rows = [{ id: 'ledger-1' }];
      ledgerRepo.findAndCount = vi.fn(async () => [rows, 1]);

      const result = await service.getCreditsSummary(TENANT_ID, 1, 20);

      expect(result).toEqual({
        metering: 'PLATFORM',
        available: 120,
        reserved: 5,
        ledger: { data: rows, total: 1, page: 1, limit: 20, totalPages: 1 },
      });
    });
  });
});
