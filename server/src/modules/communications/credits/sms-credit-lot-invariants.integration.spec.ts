import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { DataSource } from 'typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { getDataSourceToken } from '@nestjs/typeorm';
import { checkLotInvariants } from './sms-credit-lot-invariants';

/** [#3853] The read-only lot invariant check against a real (throwaway) test DB. */
describe('checkLotInvariants (integration)', () => {
  let ds: DataSource;
  let A: string;
  let B: string;

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    ds = module.get(getDataSourceToken());
  }, 60000);

  afterAll(async () => {
    await ds.destroy();
  });

  async function makeSchool(name: string): Promise<string> {
    const [{ id }] = await ds.query(
      `INSERT INTO "schools" (id, name, slug) VALUES (gen_random_uuid(), $1, 'inv-' || substr(gen_random_uuid()::text, 1, 8)) RETURNING id`,
      [name],
    );
    return id;
  }

  beforeEach(async () => {
    A = await makeSchool('Invariants A');
    B = await makeSchool('Invariants B');
  });

  afterEach(async () => {
    await ds.query(`DELETE FROM "schools" WHERE id IN ($1, $2)`, [A, B]);
  });

  /** A clean school: one lot with 7 free + 3 reserved units, one open draw of 3, balance 7/3. */
  async function cleanSchool(tenantId: string) {
    const [{ id }] = await ds.query(
      `INSERT INTO "sms_credit_lots" (tenant_id, source, units_total, remaining, reserved_units)
       VALUES ($1, 'MANUAL', 10, 7, 3) RETURNING id`,
      [tenantId],
    );
    await ds.query(
      `INSERT INTO "sms_credit_lot_draws" (tenant_id, lot_id, reserve_key, units, open_units)
       VALUES ($1, $2, $3, 3, 3)`,
      [tenantId, id, `k-${tenantId}`],
    );
    await ds.query(
      `INSERT INTO "sms_credit_balance" (tenant_id, available, reserved) VALUES ($1, 7, 3)`,
      [tenantId],
    );
    return id as string;
  }

  const one = async (tenantId: string) => (await checkLotInvariants(ds, { tenantId }))[0];

  it('a clean school is OK', async () => {
    await cleanSchool(A);
    expect(await one(A)).toEqual({
      tenantId: A,
      available: 7,
      lotsRemaining: 7,
      reserved: 3,
      openDraws: 3,
      lotsBroken: [],
    });
  });

  it('a hand-edited balance shows both numbers', async () => {
    await cleanSchool(A);
    await ds.query(`UPDATE "sms_credit_balance" SET available = 9 WHERE tenant_id = $1`, [A]);
    expect(await one(A)).toMatchObject({ available: 9, lotsRemaining: 7, lotsBroken: [] });
  });

  it('a reserved count off by one shows both numbers', async () => {
    await cleanSchool(A);
    await ds.query(`UPDATE "sms_credit_balance" SET reserved = 4 WHERE tenant_id = $1`, [A]);
    expect(await one(A)).toMatchObject({ reserved: 4, openDraws: 3, available: 7 });
  });

  it('a lot with the wrong status is broken', async () => {
    const lotId = await cleanSchool(A);
    // USED_UP while 7 units are still free.
    await ds.query(`UPDATE "sms_credit_lots" SET status = 'USED_UP' WHERE id = $1`, [lotId]);
    expect((await one(A)).lotsBroken).toEqual([lotId]);
  });

  it('an ACTIVE lot with nothing left and no reserve is broken', async () => {
    const [{ id }] = await ds.query(
      `INSERT INTO "sms_credit_lots" (tenant_id, source, units_total, remaining, debited_units)
       VALUES ($1, 'MANUAL', 5, 0, 5) RETURNING id`,
      [A],
    );
    expect((await one(A)).lotsBroken).toEqual([id]);
  });

  it('tenantId limits the check to one school', async () => {
    await cleanSchool(A);
    await cleanSchool(B);
    const both = (await checkLotInvariants(ds)).filter((r) => [A, B].includes(r.tenantId));
    expect(both).toHaveLength(2);
    expect(await checkLotInvariants(ds, { tenantId: B })).toHaveLength(1);
  });

  it('a school with no lots and a zero balance is OK', async () => {
    await ds.query(`INSERT INTO "sms_credit_balance" (tenant_id, available, reserved) VALUES ($1, 0, 0)`, [A]);
    expect(await one(A)).toEqual({
      tenantId: A,
      available: 0,
      lotsRemaining: 0,
      reserved: 0,
      openDraws: 0,
      lotsBroken: [],
    });
  });
});
