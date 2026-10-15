import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataSource, QueryRunner } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { ExamMarkEntryDeadlineAndCommsIndex1791900000100 } from '../src/migrations/1791900000100-ExamMarkEntryDeadlineAndCommsIndex';

/**
 * [8.10.7.2.13] `exams.mark_entry_deadline` + the communication_logs
 * (tenant_id, status, created_at) index. down()/up() are DDL on the shared
 * worker DB, so the round trip runs in one transaction that is rolled back.
 */
describe('ExamMarkEntryDeadlineAndCommsIndex1791900000100 (integration)', () => {
  let dataSource: DataSource;
  let queryRunner: QueryRunner;
  const migration = new ExamMarkEntryDeadlineAndCommsIndex1791900000100();
  const INDEX = 'IDX_91e00e5f77a240b92c6713ef1d';

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    dataSource = module.get<DataSource>(getDataSourceToken());
    queryRunner = dataSource.createQueryRunner();
  }, 60000);

  afterAll(async () => {
    await queryRunner.release();
    await dataSource.destroy();
  });

  const column = (q: QueryRunner) =>
    q.query(
      `SELECT data_type, is_nullable FROM information_schema.columns
       WHERE table_name = 'exams' AND column_name = 'mark_entry_deadline'`,
    );
  const index = (q: QueryRunner) =>
    q.query(`SELECT indexdef FROM pg_indexes WHERE indexname = $1`, [INDEX]);

  it('after up: nullable date column and the 3-column index exist', async () => {
    expect(await column(queryRunner)).toEqual([{ data_type: 'date', is_nullable: 'YES' }]);
    const idx = await index(queryRunner);
    expect(idx).toHaveLength(1);
    expect(idx[0].indexdef).toContain('(tenant_id, status, created_at)');
  });

  it('down drops both, up restores them; existing exams keep a NULL deadline', async () => {
    await queryRunner.startTransaction();
    try {
      await migration.down(queryRunner);
      expect(await column(queryRunner)).toHaveLength(0);
      expect(await index(queryRunner)).toHaveLength(0);

      await migration.up(queryRunner);
      expect(await column(queryRunner)).toHaveLength(1);
      expect(await index(queryRunner)).toHaveLength(1);
      expect(
        await queryRunner.query(`SELECT 1 FROM exams WHERE mark_entry_deadline IS NOT NULL`),
      ).toHaveLength(0);
    } finally {
      await queryRunner.rollbackTransaction();
    }
  });

  it('the failed-message count query uses the new index', async () => {
    await queryRunner.startTransaction();
    try {
      // Tiny table: forbid the seq scan so the planner shows which index it prefers.
      await queryRunner.query(`SET LOCAL enable_seqscan = off`);
      await queryRunner.query(`ANALYZE communication_logs`);
      const plan: Array<{ 'QUERY PLAN': string }> = await queryRunner.query(
        `EXPLAIN SELECT count(*) FROM communication_logs
         WHERE tenant_id = $1 AND status = 'FAILED' AND created_at >= $2`,
        ['00000000-0000-4000-8000-000000000001', '2026-01-01'],
      );
      expect(plan.map((r) => r['QUERY PLAN']).join('\n')).toContain(INDEX);
    } finally {
      await queryRunner.rollbackTransaction();
    }
  });
});
