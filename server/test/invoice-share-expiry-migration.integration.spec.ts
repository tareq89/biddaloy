import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataSource, QueryRunner } from 'typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { AddInvoiceShareTokenExpiry1791805000500 } from '../src/migrations/1791805000500-AddInvoiceShareTokenExpiry';

/**
 * [75.19-b, D22] Runs the share-link expiry migration's `down`/`up` directly
 * against the (already migrated) test database. Existing rows must get
 * 30 days from the migration, not from their own `created_at`.
 */
describe('AddInvoiceShareTokenExpiry1791805000500 (integration)', () => {
  let dataSource: DataSource;
  let queryRunner: QueryRunner;
  const migration = new AddInvoiceShareTokenExpiry1791805000500();

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    dataSource = module.get(DataSource);
    queryRunner = dataSource.createQueryRunner();
  }, 60000);

  afterAll(async () => {
    await queryRunner.release();
    await dataSource.destroy();
  });

  async function columnInfo(): Promise<Array<{ is_nullable: string }>> {
    return dataSource.query(
      `SELECT is_nullable FROM information_schema.columns
       WHERE table_name = 'invoice_share_tokens' AND column_name = 'expires_at'`,
    );
  }

  it('down() drops the column', async () => {
    await migration.down(queryRunner);
    expect(await columnInfo()).toEqual([]);
  });

  it('up() backfills existing rows to now + 30 days (not created_at + 30) and sets NOT NULL', async () => {
    // A row from "before deploy": created 100 days ago, so created_at + 30d is long past.
    // FK-free insert is not possible (FKs exist), so borrow real ids when present; otherwise
    // drop the FKs for this row by inserting inside a transaction with constraints deferred.
    await dataSource.query(`ALTER TABLE invoice_share_tokens DISABLE TRIGGER ALL`);
    try {
      await dataSource.query(
        `INSERT INTO invoice_share_tokens (tenant_id, invoice_id, token_hash, created_by_user_id, created_at)
         VALUES (gen_random_uuid(), gen_random_uuid(), repeat('a', 64), gen_random_uuid(), now() - interval '100 days')`,
      );
      const before = Date.now();
      await migration.up(queryRunner);
      const after = Date.now();

      const [{ expires_at }] = await dataSource.query(
        `SELECT expires_at FROM invoice_share_tokens WHERE token_hash = repeat('a', 64)`,
      );
      const thirtyDays = 30 * 24 * 3_600_000;
      expect(new Date(expires_at).getTime()).toBeGreaterThanOrEqual(before - 5_000 + thirtyDays);
      expect(new Date(expires_at).getTime()).toBeLessThanOrEqual(after + 5_000 + thirtyDays);
      expect(await columnInfo()).toEqual([{ is_nullable: 'NO' }]);
    } finally {
      await dataSource.query(`DELETE FROM invoice_share_tokens WHERE token_hash = repeat('a', 64)`);
      await dataSource.query(`ALTER TABLE invoice_share_tokens ENABLE TRIGGER ALL`);
    }
  });

  it('is back in the up state for later spec files (down then up round-trips)', async () => {
    await migration.down(queryRunner);
    await migration.up(queryRunner);
    expect(await columnInfo()).toEqual([{ is_nullable: 'NO' }]);
  });
});
