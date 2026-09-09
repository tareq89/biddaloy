import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { DataSource, Repository } from 'typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { SmsCreditBalance } from './entities/sms-credit-balance.entity';
import { SmsCreditLedger, SmsCreditLedgerKind } from './entities/sms-credit-ledger.entity';
import { SmsCreditService } from './sms-credit.service';

/**
 * [15.6.3/#546] Runs `SmsCreditService` against the real, migrated
 * `sms_credit_ledger`/`sms_credit_balance` schema (#545) — no
 * `synchronize`/`dropSchema` here, since that would rebuild the tables
 * from entity metadata and drop the `CHECK` constraint the migration
 * added, which several of these assertions depend on.
 *
 * `schoolsService` is a bare stub (`isMetered` isn't exercised here —
 * that's covered by the unit spec's mocked-settings cases) rather than
 * the whole `SchoolsModule` wiring, to keep this file's setup scoped to
 * what `SmsCreditService` itself needs.
 */
describe('SmsCreditService (integration)', () => {
  let dataSource: DataSource;
  let balanceRepo: Repository<SmsCreditBalance>;
  let ledgerRepo: Repository<SmsCreditLedger>;
  let service: SmsCreditService;
  let tenantA: string;
  let tenantB: string;

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    dataSource = module.get(getDataSourceToken());
    balanceRepo = module.get(getRepositoryToken(SmsCreditBalance));
    ledgerRepo = module.get(getRepositoryToken(SmsCreditLedger));
    service = new SmsCreditService(balanceRepo, ledgerRepo, dataSource, {
      getResolvedSettings: async () => ({}),
    } as any);
  }, 60000);

  afterAll(async () => {
    await dataSource.destroy();
  });

  async function makeSchool(name: string): Promise<string> {
    const [{ id }] = await dataSource.query(
      `INSERT INTO "schools" (id, name, slug) VALUES (gen_random_uuid(), $1, 'sms-credit-' || substr(gen_random_uuid()::text, 1, 8)) RETURNING id`,
      [name],
    );
    return id;
  }

  beforeEach(async () => {
    tenantA = await makeSchool('SMS Credit Service Test A');
    tenantB = await makeSchool('SMS Credit Service Test B');
  });

  afterEach(async () => {
    await dataSource.query(`DELETE FROM "schools" WHERE id IN ($1, $2)`, [tenantA, tenantB]);
  });

  it('reserves under concurrency without overrunning the balance', async () => {
    await service.grant(tenantA, 100, { idempotencyKey: `grant-${tenantA}` });

    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => service.reserve(tenantA, 10, `reserve-${tenantA}-${i}`)),
    );

    const succeeded = results.filter((r) => r.ok === true);
    const failed = results.filter((r) => r.ok === false);
    expect(succeeded).toHaveLength(10);
    expect(failed).toHaveLength(10);

    const balance = await service.getBalance(tenantA);
    expect(balance).toEqual({ available: 0, reserved: 100 });

    const reserveRows = await ledgerRepo.count({
      where: { tenant_id: tenantA, kind: SmsCreditLedgerKind.RESERVE },
    });
    expect(reserveRows).toBe(10);
  });

  it('settles a reservation exactly once no matter how many times settle is called', async () => {
    await service.grant(tenantA, 50, { idempotencyKey: `grant-settle-${tenantA}` });
    await service.reserve(tenantA, 20, `reserve-settle-${tenantA}`);

    await service.settle(tenantA, `reserve-settle-${tenantA}`, 'DEBIT');
    await service.settle(tenantA, `reserve-settle-${tenantA}`, 'DEBIT');
    await service.settle(tenantA, `reserve-settle-${tenantA}`, 'DEBIT');

    const balance = await service.getBalance(tenantA);
    expect(balance).toEqual({ available: 30, reserved: 0 });

    const debitRows = await ledgerRepo.count({
      where: { tenant_id: tenantA, kind: SmsCreditLedgerKind.DEBIT },
    });
    expect(debitRows).toBe(1);
  });

  it('RELEASE returns units to available and is also settle-once', async () => {
    await service.grant(tenantA, 50, { idempotencyKey: `grant-release-${tenantA}` });
    await service.reserve(tenantA, 20, `reserve-release-${tenantA}`);

    await service.settle(tenantA, `reserve-release-${tenantA}`, 'RELEASE');
    await service.settle(tenantA, `reserve-release-${tenantA}`, 'RELEASE');

    const balance = await service.getBalance(tenantA);
    expect(balance).toEqual({ available: 50, reserved: 0 });
  });

  it('settlePart peels units off a batch reservation idempotently per log key', async () => {
    await service.grant(tenantA, 100, { idempotencyKey: `grant-batch-${tenantA}` });
    const batchKey = `batch-${tenantA}`;
    await service.reserve(tenantA, 30, batchKey);

    await service.settlePart(tenantA, batchKey, `log-1-${tenantA}`, 10, 'DEBIT');
    await service.settlePart(tenantA, batchKey, `log-1-${tenantA}`, 10, 'DEBIT'); // repeat — no-op
    await service.settlePart(tenantA, batchKey, `log-2-${tenantA}`, 5, 'RELEASE');

    const balance = await service.getBalance(tenantA);
    // available: 100 - 30 (reserved) + 5 (released) = 75
    // reserved: 30 - 10 (debited) - 5 (released) = 15
    expect(balance).toEqual({ available: 75, reserved: 15 });
  });

  it('settlePart rejects moving more units than remain reserved for the batch', async () => {
    await service.grant(tenantA, 100, { idempotencyKey: `grant-over-${tenantA}` });
    const batchKey = `batch-over-${tenantA}`;
    await service.reserve(tenantA, 10, batchKey);

    await expect(
      service.settlePart(tenantA, batchKey, `log-over-${tenantA}`, 11, 'DEBIT'),
    ).rejects.toThrow();
  });

  it('does not let a reserve on tenant B touch tenant A balance', async () => {
    await service.grant(tenantA, 100, { idempotencyKey: `grant-iso-a-${tenantA}` });
    await service.grant(tenantB, 100, { idempotencyKey: `grant-iso-b-${tenantB}` });

    await service.reserve(tenantB, 40, `reserve-iso-${tenantB}`);

    const balanceA = await service.getBalance(tenantA);
    const balanceB = await service.getBalance(tenantB);
    expect(balanceA).toEqual({ available: 100, reserved: 0 });
    expect(balanceB).toEqual({ available: 60, reserved: 40 });

    // Cross-tenant rejection for the ledger read (#550): A never sees B's rows.
    const ledgerA = await service.listLedger(tenantA, 1, 50);
    expect(ledgerA.total).toBe(1);
    expect(ledgerA.data.every((row) => row.tenant_id === tenantA)).toBe(true);
    expect(ledgerA.data.map((row) => row.kind)).toEqual([SmsCreditLedgerKind.GRANT]);
  });

  it('adjust below zero is rejected and getBalance is unchanged', async () => {
    await service.grant(tenantA, 10, { idempotencyKey: `grant-adj-${tenantA}` });

    await expect(
      service.adjust(tenantA, -20, { idempotencyKey: `adjust-neg-${tenantA}` }),
    ).rejects.toThrow();

    const balance = await service.getBalance(tenantA);
    expect(balance).toEqual({ available: 10, reserved: 0 });
  });

  it('adjust below zero on a tenant with no balance row is rejected', async () => {
    await expect(
      service.adjust(tenantA, -20, { idempotencyKey: `adjust-fresh-${tenantA}` }),
    ).rejects.toThrow();

    const balance = await service.getBalance(tenantA);
    expect(balance).toEqual({ available: 0, reserved: 0 });

    const ledger = await service.listLedger(tenantA, 1, 50);
    expect(ledger.total).toBe(0);
  });

  it('getBalance returns zeros when no balance row exists yet', async () => {
    const balance = await service.getBalance(tenantA);
    expect(balance).toEqual({ available: 0, reserved: 0 });
  });
});
