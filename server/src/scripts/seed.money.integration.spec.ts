import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { ensureMoneySeed } from './seed.money';

/** [100.3.gD-01] The e2e money seed: twice = same rows. */
describe('ensureMoneySeed (integration)', () => {
  let ds: DataSource;

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    ds = module.get<DataSource>(getDataSourceToken());
  }, 60000);

  afterAll(async () => {
    if (!ds) return;
    await ds.query(`DELETE FROM coupons WHERE code IN ('E2E-HALF','E2E-FREE')`);
    await ds.query(`DELETE FROM plans WHERE name = 'Plus'`);
    await ds.destroy();
  });

  it('leaves exactly one Plus plan and the two coupons after two runs', async () => {
    await ensureMoneySeed(ds);
    await ensureMoneySeed(ds);
    const plans = await ds.query(`SELECT unit_price_paisa, active FROM plans WHERE name = 'Plus'`);
    expect(plans).toEqual([{ unit_price_paisa: 1500, active: true }]);
    const coupons = await ds.query(
      `SELECT code, percent, scope, max_months FROM coupons WHERE code LIKE 'E2E-%' ORDER BY code`,
    );
    expect(coupons).toEqual([
      { code: 'E2E-FREE', percent: 100, scope: 'ALL', max_months: null },
      { code: 'E2E-HALF', percent: 50, scope: 'ALL', max_months: 3 },
    ]);
  });
});
