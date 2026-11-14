import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SmsCreditSummaryService } from './sms-credit-summary.service';

const DAY = 24 * 60 * 60 * 1000;

describe('SmsCreditSummaryService (integration)', () => {
  let ds: DataSource;
  let metering = 'PLATFORM';
  let svc: SmsCreditSummaryService;
  let a: string;
  let b: string;

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    ds = module.get(getDataSourceToken());
    svc = new SmsCreditSummaryService(ds, {
      getResolvedSettings: async () => ({ communications: { sms: { metering } } }),
    } as any);
  }, 60000);

  afterAll(async () => {
    if (ds) await ds.destroy();
  });

  const makeSchool = async (): Promise<string> => {
    const [{ id }] = await ds.query(
      `INSERT INTO "schools" (id, name, slug) VALUES (gen_random_uuid(), 'Sum', 'sum-' || substr(gen_random_uuid()::text, 1, 8)) RETURNING id`,
    );
    return id;
  };

  const addLot = (
    t: string,
    total: number,
    remaining: number,
    expires: Date | null,
    status = 'ACTIVE',
  ) =>
    ds.query(
      `INSERT INTO "sms_credit_lots" (tenant_id, source, units_total, remaining, expired_units, debited_units, expires_at, status)
       VALUES ($1,'MANUAL',$2,$3,$4,0,$5,$6)`,
      [t, total, remaining, total - remaining, expires, status],
    );

  beforeEach(async () => {
    metering = 'PLATFORM';
    a = await makeSchool();
    b = await makeSchool();
  });

  afterEach(async () => {
    await ds.query(`DELETE FROM "sms_credit_lots" WHERE tenant_id IN ($1, $2)`, [a, b]);
    await ds.query(`DELETE FROM "schools" WHERE id IN ($1, $2)`, [a, b]);
  });

  it("shows only this school's lots, and hides an expired one", async () => {
    await addLot(a, 100, 100, new Date(Date.now() + 5 * DAY));
    await addLot(a, 50, 0, new Date(Date.now() - DAY), 'EXPIRED');
    await addLot(b, 900, 900, null);

    const r = await svc.forSchool(a);

    expect(r.lots).toHaveLength(1);
    expect(r.lots[0].units_total).toBe(100);
    expect(r.orders).toEqual([]);
  });

  it('metering OFF returns the zeroed shape even with lots', async () => {
    await addLot(a, 100, 100, null);
    metering = 'OFF';

    const r = await svc.forSchool(a);

    expect(r).toMatchObject({ lots: [], orders: [], almostFinished: false, stopped: false });
  });
});
