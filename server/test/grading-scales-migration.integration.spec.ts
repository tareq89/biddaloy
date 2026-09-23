import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataSource } from 'typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { SEED_TENANT_ID, SEED_ACADEMIC_YEAR_ID } from '@test/constants';
import { School } from '../src/modules/schools/entities/school.entity';

/**
 * [20.1.1] DB-level invariants the `AddGradingScales` migration adds,
 * that no unit test can see: constraints only Postgres enforces.
 */
describe('AddGradingScales1789800011000 (integration)', () => {
  let dataSource: DataSource;
  const TENANT_ID = SEED_TENANT_ID;

  beforeAll(async () => {
    const module = await createTestModule([School], []);
    dataSource = module.get(DataSource);
  }, 60000);

  afterAll(async () => {
    await dataSource.destroy();
  });

  it('rejects two bands in the same scale sharing a sequence', async () => {
    const [scale] = await dataSource.query(
      `INSERT INTO "grading_scales" (id, tenant_id, academic_year_id, name) VALUES (gen_random_uuid(), $1, $2, 'Test Scale') RETURNING id`,
      [TENANT_ID, SEED_ACADEMIC_YEAR_ID],
    );
    await dataSource.query(
      `INSERT INTO "grading_bands" (id, tenant_id, scale_id, percent_from, percent_to, grade, sequence) VALUES (gen_random_uuid(), $1, $2, 80, 100, 'A+', 1)`,
      [TENANT_ID, scale.id],
    );
    await expect(
      dataSource.query(
        `INSERT INTO "grading_bands" (id, tenant_id, scale_id, percent_from, percent_to, grade, sequence) VALUES (gen_random_uuid(), $1, $2, 70, 79, 'A', 1)`,
        [TENANT_ID, scale.id],
      ),
    ).rejects.toThrow();
  });

  it('accepts a comment on a band and soft-deletes it', async () => {
    const [scale] = await dataSource.query(
      `INSERT INTO "grading_scales" (id, tenant_id, academic_year_id, name) VALUES (gen_random_uuid(), $1, $2, 'Test Scale 2') RETURNING id`,
      [TENANT_ID, SEED_ACADEMIC_YEAR_ID],
    );
    const [band] = await dataSource.query(
      `INSERT INTO "grading_bands" (id, tenant_id, scale_id, percent_from, percent_to, grade, sequence, comment) VALUES (gen_random_uuid(), $1, $2, 80, 100, 'A+', 1, 'Top band') RETURNING id, comment, deleted_at`,
      [TENANT_ID, scale.id],
    );
    expect(band.comment).toBe('Top band');
    expect(band.deleted_at).toBeNull();

    await dataSource.query(`UPDATE "grading_bands" SET deleted_at = now() WHERE id = $1`, [
      band.id,
    ]);
    const [deleted] = await dataSource.query(
      `SELECT deleted_at FROM "grading_bands" WHERE id = $1`,
      [band.id],
    );
    expect(deleted.deleted_at).not.toBeNull();
  });
});
