import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataSource, QueryRunner } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { PrintJobItemSerialsAndContext1791400000000 } from '../src/migrations/1791400000000-PrintJobItemSerialsAndContext';

/**
 * [48.1.2] `down()` then `up()` on a real database for the print_job_items
 * serial/context columns and the two partial copy-number indexes.
 */
describe('PrintJobItemSerialsAndContext1791400000000 (integration)', () => {
  let dataSource: DataSource;
  let queryRunner: QueryRunner;
  const migration = new PrintJobItemSerialsAndContext1791400000000();

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    dataSource = module.get<DataSource>(getDataSourceToken());
    queryRunner = dataSource.createQueryRunner();
  }, 60000);

  afterAll(async () => {
    await queryRunner.release();
    await dataSource.destroy();
  });

  // Runs inside one transaction that is rolled back: down()/up() are DDL on
  // the shared worker DB, and a half-finished round trip would poison every
  // later spec on it, so the schema is always left migrated.
  it('down() removes the columns and restores the constraint; up() brings them back', async () => {
    const q = (sql: string) => queryRunner.query(sql);
    const columns = async () =>
      (
        (await q(
          `SELECT column_name FROM information_schema.columns
           WHERE table_name = 'print_job_items'
             AND column_name IN ('serial_no','serial_year','context_type','context_id')`,
        )) as unknown[]
      ).length;
    const indexes = async () =>
      (
        (await q(
          `SELECT indexname FROM pg_indexes WHERE tablename = 'print_job_items'
             AND indexname IN ('UQ_print_job_items_copy','UQ_print_job_items_serial_copy','IDX_print_job_items_context')`,
        )) as unknown[]
      ).length;
    const copyIsConstraint = async () =>
      (
        (await q(
          `SELECT 1 FROM pg_constraint WHERE conname = 'UQ_print_job_items_copy' AND contype = 'u'`,
        )) as unknown[]
      ).length;

    await queryRunner.startTransaction();
    try {
      expect(await columns()).toBe(4);
      expect(await indexes()).toBe(3);
      expect(await copyIsConstraint()).toBe(0);

      await migration.down(queryRunner);
      expect(await columns()).toBe(0);
      expect(await indexes()).toBe(1);
      expect(await copyIsConstraint()).toBe(1);

      await migration.up(queryRunner);
      expect(await columns()).toBe(4);
      expect(await indexes()).toBe(3);
      expect(await copyIsConstraint()).toBe(0);
    } finally {
      await queryRunner.rollbackTransaction();
    }
  });
});
