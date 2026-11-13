import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SmsAllocationService } from './sms-allocation.service';

describe('SmsAllocationService.promisedUnused (integration)', () => {
  let ds: DataSource;
  let svc: SmsAllocationService;
  const schools: string[] = [];

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    ds = module.get(getDataSourceToken());
    svc = new SmsAllocationService(ds, {} as never, {} as never);
  }, 60000);

  afterAll(async () => {
    if (ds) await ds.destroy();
  });

  afterEach(async () => {
    if (schools.length) await ds.query(`DELETE FROM "schools" WHERE id = ANY($1)`, [schools]);
    schools.length = 0;
  });

  const school = async (settings: object | null): Promise<string> => {
    const [{ id }] = await ds.query(
      `INSERT INTO "schools" (id, name, slug, settings) VALUES (gen_random_uuid(), 'Promised', 'promised-' || substr(gen_random_uuid()::text, 1, 8), $1) RETURNING id`,
      [settings ? JSON.stringify(settings) : null],
    );
    schools.push(id);
    return id;
  };

  const lot = (tenant: string, remaining: number, reserved: number, expiresAt: string | null) =>
    ds.query(
      `INSERT INTO "sms_credit_lots" (tenant_id, source, units_total, remaining, reserved_units, expires_at, status)
       VALUES ($1, 'MANUAL', $2, $3, $4, $5, 'ACTIVE')`,
      [tenant, remaining + reserved, remaining, reserved, expiresAt],
    );

  const metered = { communications: { sms: { metering: 'PLATFORM' } } };

  it('counts unexpired remaining and reserved of PLATFORM schools, ignores expired remainder and OFF schools', async () => {
    const before = await svc.promisedUnused();
    const a = await school(metered);
    const off = await school({ communications: { sms: { metering: 'OFF' } } });
    const absent = await school(null);
    await lot(a, 100, 30, null); // never expires: 130
    await lot(a, 50, 0, new Date(Date.now() + 86_400_000).toISOString()); // future: 50
    await lot(a, 999, 0, new Date(Date.now() - 86_400_000).toISOString()); // expired remainder: 0
    await lot(off, 500, 5, null); // not metered by platform
    await lot(absent, 500, 5, null); // absent = OFF
    expect((await svc.promisedUnused()) - before).toBe(180);
  });
});
