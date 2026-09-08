import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { DataSource, QueryRunner } from 'typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { School } from '../src/modules/schools/entities/school.entity';
import { AddSmsCreditLedger1789200000000 } from '../src/migrations/1789200000000-AddSmsCreditLedger';

/**
 * [15.6.2/#545] Runs the `sms_credit_ledger`/`sms_credit_balance`
 * migration's `up`/`down` directly against the test database (already
 * migrated once by `server/test/global-setup.ts`, which includes this
 * migration). `down()` then `up()` run inside the same test — the
 * per-test cleanup hook in `test/setup.ts` runs `DELETE FROM` against
 * every table in `reset-order.ts` between tests, including these two, so
 * a test that ends with the tables dropped would break the *next* test's
 * setup. Restoring `up` state before the test returns keeps every later
 * spec file in the same `vitest run` unaffected.
 */
describe('AddSmsCreditLedger1789200000000 (integration)', () => {
  let dataSource: DataSource;
  let queryRunner: QueryRunner;
  let tenantId: string;
  const migration = new AddSmsCreditLedger1789200000000();

  beforeAll(async () => {
    const module = await createTestModule([School], []);
    dataSource = module.get(DataSource);
    queryRunner = dataSource.createQueryRunner();
  }, 60000);

  afterAll(async () => {
    await queryRunner.release();
    await dataSource.destroy();
  });

  beforeEach(async () => {
    const [{ id }] = await dataSource.query(
      `INSERT INTO "schools" (id, name, slug) VALUES (gen_random_uuid(), 'SMS Credit Test School', 'sms-credit-test-' || substr(gen_random_uuid()::text, 1, 8)) RETURNING id`,
    );
    tenantId = id;
  });

  afterEach(async () => {
    await dataSource.query(`DELETE FROM "schools" WHERE id = $1`, [tenantId]);
  });

  async function tableNames(): Promise<string[]> {
    const rows: Array<{ table_name: string }> = await dataSource.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('sms_credit_ledger', 'sms_credit_balance')`,
    );
    return rows.map((r) => r.table_name).sort();
  }

  it('is up after global migrations run: both tables exist', async () => {
    expect(await tableNames()).toEqual(['sms_credit_balance', 'sms_credit_ledger']);
  });

  it('down() drops both tables, up() re-creates them', async () => {
    await migration.down(queryRunner);
    expect(await tableNames()).toEqual([]);

    await migration.up(queryRunner);
    expect(await tableNames()).toEqual(['sms_credit_balance', 'sms_credit_ledger']);
  });

  it('enforces the unique (tenant_id, idempotency_key) constraint on sms_credit_ledger', async () => {
    await dataSource.query(
      `INSERT INTO "sms_credit_ledger" (tenant_id, kind, units, reference_type, idempotency_key)
       VALUES ($1, 'GRANT', 100, 'manual', 'seed-key-1')`,
      [tenantId],
    );

    // Same tenant, same key — rejected.
    await expect(
      dataSource.query(
        `INSERT INTO "sms_credit_ledger" (tenant_id, kind, units, reference_type, idempotency_key)
         VALUES ($1, 'GRANT', 50, 'manual', 'seed-key-1')`,
        [tenantId],
      ),
    ).rejects.toThrow();

    // Same key, a *different* tenant — the constraint is per-tenant, not global.
    const [{ id: otherTenantId }] = await dataSource.query(
      `INSERT INTO "schools" (id, name, slug) VALUES (gen_random_uuid(), 'SMS Credit Test School 2', 'sms-credit-test-2-' || substr(gen_random_uuid()::text, 1, 8)) RETURNING id`,
    );
    try {
      await expect(
        dataSource.query(
          `INSERT INTO "sms_credit_ledger" (tenant_id, kind, units, reference_type, idempotency_key)
           VALUES ($1, 'GRANT', 50, 'manual', 'seed-key-1')`,
          [otherTenantId],
        ),
      ).resolves.toBeDefined();
    } finally {
      await dataSource.query(`DELETE FROM "schools" WHERE id = $1`, [otherTenantId]);
    }
  });

  it('enforces the non-negative check constraint on sms_credit_balance', async () => {
    await expect(
      dataSource.query(
        `INSERT INTO "sms_credit_balance" (tenant_id, available, reserved) VALUES ($1, -1, 0)`,
        [tenantId],
      ),
    ).rejects.toThrow();

    await expect(
      dataSource.query(
        `INSERT INTO "sms_credit_balance" (tenant_id, available, reserved) VALUES ($1, 10, 0)`,
        [tenantId],
      ),
    ).resolves.toBeDefined();
  });

  it('creates no balance rows for existing tenants — none exist until a credit event happens', async () => {
    const [{ count }] = await dataSource.query(
      `SELECT count(*)::int FROM "sms_credit_balance" WHERE tenant_id = $1`,
      [tenantId],
    );
    expect(count).toBe(0);
  });
});
