import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { todayInSchoolTz } from '../../common/time';
import { nextReceiptNumber } from './receipt-number.util';

describe('nextReceiptNumber (integration)', () => {
  let ds: DataSource;
  let school: string;
  let catalogId: string;
  const year = todayInSchoolTz().slice(0, 4);
  const num = (n: number) => `SMR-${year}-${String(n).padStart(6, '0')}`;
  const sfx = () => Math.random().toString(36).slice(2, 10);

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    ds = module.get(getDataSourceToken());
  }, 60000);

  // The suite resets the tables before every test, so each test makes its own school and package.
  beforeEach(async () => {
    [{ id: school }] = await ds.query(
      `INSERT INTO schools (id, name, slug) VALUES (gen_random_uuid(), 'Rcpt', 'rcpt-' || $1) RETURNING id`,
      [sfx()],
    );
    [{ id: catalogId }] = await ds.query(
      `INSERT INTO sms_bundle_catalog (name, sms_count, validity_days, price_paisa, active) VALUES ($1, 500, 30, 10000, true) RETURNING id`,
      [`Pkg ${sfx()}`],
    );
  });

  afterAll(async () => {
    if (ds) await ds.destroy();
  });

  const seat = (receipt: string) =>
    ds.query(
      `INSERT INTO seat_orders (school_id, seats, months, unit_price_paisa, amount_paisa, period_start, period_end, status, idempotency_key, receipt_number)
       VALUES ($1, 1, 1, 1000, 1000, '2030-01-01', '2030-02-01', 'PAID', $2, $3)`,
      [school, sfx(), receipt],
    );
  const bundle = (receipt: string, m = ds.manager) =>
    m.query(
      `INSERT INTO sms_bundle_orders (school_id, catalog_id, name_snapshot, sms_count, validity_days, price_paisa, status, idempotency_key, receipt_number)
       VALUES ($1, $2, 'Pkg', 5, 30, 100, 'ACTIVE', $3, $4)`,
      [school, catalogId, sfx(), receipt],
    );
  const next = () => ds.transaction((m) => nextReceiptNumber(m));

  it('a seat order and a package order paid in the same year get consecutive numbers', async () => {
    const base = Number((await next()).slice(-6));
    await seat(num(base));
    expect(await next()).toBe(num(base + 1));
    await bundle(num(base + 1));
    expect(await next()).toBe(num(base + 2));
    await seat(num(base + 2));
    expect(await next()).toBe(num(base + 3));
  });

  it('two payments at once never share a number (the advisory lock is held to commit)', async () => {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let firstHasNumber!: () => void;
    const gotFirst = new Promise<void>((r) => (firstHasNumber = r));
    // Payment 1 takes a number and writes it, then is held open; payment 2 must wait on the lock.
    const p1 = ds.transaction(async (m) => {
      const n = await nextReceiptNumber(m);
      await bundle(n, m);
      firstHasNumber();
      await held;
      return n;
    });
    await gotFirst;
    const p2 = next();
    release();
    const [a, b] = [await p1, await p2];
    expect(a).not.toBe(b);
  });
});
