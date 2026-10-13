import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataSource, QueryRunner } from 'typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { AddUsersTokensValidAfter1791805000400 } from '../src/migrations/1791805000400-AddUsersTokensValidAfter';

/**
 * [75.2] Runs the migration's `up`/`down` directly against the test database
 * (already migrated once by global-setup). Drops and re-adds the column, then
 * leaves the schema in the "up" state for later spec files.
 */
describe('AddUsersTokensValidAfter1791805000400 (integration)', () => {
  let dataSource: DataSource;
  let queryRunner: QueryRunner;
  const migration = new AddUsersTokensValidAfter1791805000400();

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    dataSource = module.get(DataSource);
    queryRunner = dataSource.createQueryRunner();
  }, 60000);

  afterAll(async () => {
    await queryRunner.release();
    await dataSource.destroy();
  });

  async function userColumns(): Promise<string[]> {
    const rows: Array<{ column_name: string }> = await dataSource.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'users'`,
    );
    return rows.map((r) => r.column_name);
  }

  it('is up after global migrations run', async () => {
    expect(await userColumns()).toContain('tokens_valid_after');
  });

  it('down() drops only that column', async () => {
    const before = await userColumns();
    await migration.down(queryRunner);
    const after = await userColumns();
    expect(after).not.toContain('tokens_valid_after');
    expect(after.sort()).toEqual(before.filter((c) => c !== 'tokens_valid_after').sort());
  });

  it('up() re-adds a nullable timestamptz column', async () => {
    await migration.up(queryRunner);
    const [col] = await dataSource.query(
      `SELECT data_type, is_nullable FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'tokens_valid_after'`,
    );
    expect(col).toEqual({ data_type: 'timestamp with time zone', is_nullable: 'YES' });
  });
});
