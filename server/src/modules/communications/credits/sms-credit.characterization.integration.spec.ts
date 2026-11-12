import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { makeMeteredCreditService } from '@test/helpers/sms-credit-ledger.helper';
import { SmsCreditService } from './sms-credit.service';

/**
 * Safety net [#3847, Epic 100 D1 D28]: today's SMS credit rules, frozen through the public
 * methods only. Wave 1 changes how credit is stored (lots); every test here must stay green
 * without edits. A failure means a rule changed, not that the test is stale.
 */
describe('SmsCreditService characterization (integration)', () => {
  let ds: DataSource;
  let svc: SmsCreditService;
  let a: string;
  let b: string;

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    ds = module.get(getDataSourceToken());
    svc = makeMeteredCreditService(ds);
  }, 60000);

  afterAll(async () => {
    if (ds) await ds.destroy();
  });

  const makeSchool = async (): Promise<string> => {
    const [{ id }] = await ds.query(
      `INSERT INTO "schools" (id, name, slug) VALUES (gen_random_uuid(), 'SMS Char', 'sms-char-' || substr(gen_random_uuid()::text, 1, 8)) RETURNING id`,
    );
    return id;
  };

  beforeEach(async () => {
    a = await makeSchool();
    b = await makeSchool();
  });

  afterEach(async () => {
    await ds.query(`DELETE FROM "schools" WHERE id IN ($1, $2)`, [a, b]);
  });

  it('characterization: grant then reserve then settle DEBIT leaves available down by the units', async () => {
    await svc.grant(a, 100, { idempotencyKey: `g-${a}` });
    expect(await svc.reserve(a, 30, `r-${a}`)).toEqual({ ok: true });
    expect(await svc.getBalance(a)).toEqual({ available: 70, reserved: 30 });
    await svc.settle(a, `r-${a}`, 'DEBIT');
    expect(await svc.getBalance(a)).toEqual({ available: 70, reserved: 0 });
  });

  it('characterization: settle RELEASE returns the units to available', async () => {
    await svc.grant(a, 100, { idempotencyKey: `g-${a}` });
    await svc.reserve(a, 30, `r-${a}`);
    await svc.settle(a, `r-${a}`, 'RELEASE');
    expect(await svc.getBalance(a)).toEqual({ available: 100, reserved: 0 });
  });

  it('characterization: settle without a reservation is a 400 and changes nothing', async () => {
    await svc.grant(a, 10, { idempotencyKey: `g-${a}` });
    await expect(svc.settle(a, `missing-${a}`, 'DEBIT')).rejects.toThrow(
      'No matching SMS credit reservation was found.',
    );
    expect(await svc.getBalance(a)).toEqual({ available: 10, reserved: 0 });
  });

  it('characterization: settlePart is once per log key', async () => {
    await svc.grant(a, 100, { idempotencyKey: `g-${a}` });
    await svc.reserve(a, 30, `batch-${a}`, { type: 'batch', id: a });
    await svc.settlePart(a, `batch-${a}`, `log-1-${a}`, 10, 'DEBIT');
    await svc.settlePart(a, `batch-${a}`, `log-1-${a}`, 10, 'DEBIT');
    await svc.settlePart(a, `batch-${a}`, `log-2-${a}`, 5, 'RELEASE');
    expect(await svc.getBalance(a)).toEqual({ available: 75, reserved: 15 });
  });

  it('characterization: settlePart cannot exceed the reservation', async () => {
    await svc.grant(a, 100, { idempotencyKey: `g-${a}` });
    await svc.reserve(a, 10, `batch-${a}`, { type: 'batch', id: a });
    await expect(svc.settlePart(a, `batch-${a}`, `log-${a}`, 11, 'DEBIT')).rejects.toThrow(
      'Settling these units would exceed the remaining reserved SMS credit balance.',
    );
    expect(await svc.getBalance(a)).toEqual({ available: 90, reserved: 10 });
  });

  it('characterization: reserve fails with ok false and the available count when short, and changes nothing', async () => {
    await svc.grant(a, 5, { idempotencyKey: `g-${a}` });
    expect(await svc.reserve(a, 6, `r-${a}`)).toEqual({ ok: false, available: 5 });
    expect(await svc.getBalance(a)).toEqual({ available: 5, reserved: 0 });
    expect((await svc.listLedger(a, 1, 50)).total).toBe(1); // the grant only
  });

  it('characterization: adjust below zero is a 400 with the existing sentence', async () => {
    await svc.grant(a, 10, { idempotencyKey: `g-${a}` });
    await expect(svc.adjust(a, -20, { idempotencyKey: `adj-${a}` })).rejects.toThrow(
      "Adjustment would drive this school's SMS credit balance below zero.",
    );
    expect(await svc.getBalance(a)).toEqual({ available: 10, reserved: 0 });
  });

  it('characterization: a positive adjust adds to available; a negative one is rejected even within the balance', async () => {
    await svc.grant(a, 10, { idempotencyKey: `g-${a}` });
    await svc.adjust(a, 4, { idempotencyKey: `adj-up-${a}` });
    expect(await svc.getBalance(a)).toEqual({ available: 14, reserved: 0 });
    // Today's upsert proposes a negative balance row, and the CHECK refuses it before the
    // conflict clause runs, so any negative adjust is a 400. Pinned as-is.
    await expect(svc.adjust(a, -4, { idempotencyKey: `adj-down-${a}` })).rejects.toThrow(
      "Adjustment would drive this school's SMS credit balance below zero.",
    );
    expect(await svc.getBalance(a)).toEqual({ available: 14, reserved: 0 });
  });

  it('characterization: refundForLog is once per log id and returns units to available', async () => {
    await svc.grant(a, 10, { idempotencyKey: `g-${a}` });
    const logId = '44444444-4444-4444-4444-444444444444';
    await ds.transaction((m) => svc.refundForLog(m, a, logId, 3));
    await ds.transaction((m) => svc.refundForLog(m, a, logId, 3));
    expect(await svc.getBalance(a)).toEqual({ available: 13, reserved: 0 });
  });

  it('characterization: a repeated idempotency key is a no-op for every operation', async () => {
    const first = await svc.grant(a, 50, { idempotencyKey: `g-${a}` });
    const again = await svc.grant(a, 50, { idempotencyKey: `g-${a}` });
    expect(first.applied).toBe(true);
    expect(again).toMatchObject({ applied: false, available: 50 });

    await svc.adjust(a, 5, { idempotencyKey: `adj-${a}` });
    expect((await svc.adjust(a, 5, { idempotencyKey: `adj-${a}` })).applied).toBe(false);

    await svc.reserve(a, 10, `r-${a}`);
    expect(await svc.reserve(a, 10, `r-${a}`)).toEqual({ ok: true });

    await svc.settle(a, `r-${a}`, 'DEBIT');
    await svc.settle(a, `r-${a}`, 'DEBIT');
    // 50 + 5 - 10 reserved, then debited once
    expect(await svc.getBalance(a)).toEqual({ available: 45, reserved: 0 });
  });

  it('characterization: two reserves racing for the last units give one success', async () => {
    await svc.grant(a, 10, { idempotencyKey: `g-${a}` });
    // Latch: both calls wait behind one gate and are released together, so they overlap
    // in flight; the row lock inside reserve then decides who wins.
    let open!: () => void;
    const gate = new Promise<void>((resolve) => (open = resolve));
    const race = ['x', 'y'].map((k) => gate.then(() => svc.reserve(a, 10, `r-${k}-${a}`)));
    open();
    const results = await Promise.all(race);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, available: 0 }]);
    expect(await svc.getBalance(a)).toEqual({ available: 0, reserved: 10 });
  });

  it('characterization: two tenants never touch each other', async () => {
    await svc.grant(a, 100, { idempotencyKey: `g-a-${a}` });
    await svc.grant(b, 100, { idempotencyKey: `g-b-${b}` });
    await svc.reserve(b, 40, `r-${b}`);
    await svc.settle(b, `r-${b}`, 'DEBIT');
    expect(await svc.getBalance(a)).toEqual({ available: 100, reserved: 0 });
    expect(await svc.getBalance(b)).toEqual({ available: 60, reserved: 0 });
    // A key used by B means nothing to A.
    await expect(svc.settle(a, `r-${b}`, 'DEBIT')).rejects.toThrow();
  });
});
