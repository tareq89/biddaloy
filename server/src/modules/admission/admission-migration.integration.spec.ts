import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { assertTestDatabaseUrl, withDbName } from '../../../test/global-setup';

/**
 * [Epic 71 / #4171] The AdmissionPipeline data move, on a throwaway database: migrate everything,
 * undo only that migration, seed an old-shape round with one applicant per status, redo it.
 */
const migrationsGlob = join(__dirname, '..', '..', 'migrations', '*.{ts,js}');
const STATUSES = ['PENDING', 'SHORTLISTED', 'ADMITTED', 'REJECTED'];

let admin: DataSource;
let ds: DataSource;
let db: string;

async function drop(name: string) {
  await admin.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1`, [
    name,
  ]);
  await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
}

const id = async (sql: string, params: unknown[] = []) =>
  ((await ds.query(sql, params)) as { id: string }[])[0].id;

describe('AdmissionPipeline migration data move', { timeout: 300_000 }, () => {
  let tenant: string;
  let intakeId: string;
  let classId: string;
  let yearId: string;

  beforeAll(async () => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    assertTestDatabaseUrl(url);
    db = `${url.split('/').pop()?.split('?')[0]}_adm_pipeline`;
    admin = new DataSource({ type: 'postgres', url: withDbName(url, 'postgres') });
    await admin.initialize();
    await drop(db);
    await admin.query(`CREATE DATABASE "${db}"`);
    ds = new DataSource({
      type: 'postgres',
      url: withDbName(url, db),
      entities: [],
      migrations: [migrationsGlob],
      migrationsTableName: 'typeorm_migrations',
      synchronize: false,
    });
    await ds.initialize();
    await ds.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    await ds.runMigrations({ transaction: 'each' });
    // Old shape: undo newest-first until this migration is reverted (later migrations may exist).
    while (
      (await ds.query(`SELECT 1 FROM typeorm_migrations WHERE timestamp = 1792300000000`)).length >
      0
    ) {
      await ds.undoLastMigration({ transaction: 'each' });
    }

    tenant = await id(`INSERT INTO schools (name, slug) VALUES ('S', 'adm-mig') RETURNING id`);
    yearId = await id(
      `INSERT INTO academic_years (tenant_id, name, start_date, end_date) VALUES ($1, 'Y', '2026-01-01', '2026-12-31') RETURNING id`,
      [tenant],
    );
    classId = await id(
      `INSERT INTO classes (tenant_id, name, academic_year_id) VALUES ($1, 'C', $2) RETURNING id`,
      [tenant, yearId],
    );
    const section = await id(
      `INSERT INTO class_sections (tenant_id, class_id, section_name) VALUES ($1, $2, 'A') RETURNING id`,
      [tenant, classId],
    );
    intakeId = await id(
      `INSERT INTO admission_intakes (tenant_id, class_section_id, title, seat_count, open_date, close_date)
       VALUES ($1, $2, 'Old', 5, '2026-01-01', '2026-02-01') RETURNING id`,
      [tenant, section],
    );
    for (const [i, status] of STATUSES.entries()) {
      await ds.query(
        `INSERT INTO admission_applicants (tenant_id, intake_id, reference_number, applicant_name, date_of_birth,
           gender, guardian_name, guardian_phone, status)
         VALUES ($1, $2, $3, $4, '2018-01-01', 'MALE', 'G', '8801700000001', $5)`,
        [tenant, intakeId, `ADM-2026-${i}`, `Kid ${i}`, status],
      );
    }
    await ds.runMigrations({ transaction: 'each' });
  }, 300_000);

  afterAll(async () => {
    if (ds?.isInitialized) await ds.destroy();
    if (admin?.isInitialized) {
      await drop(db);
      await admin.destroy();
    }
  }, 60_000);

  it('keeps every reference number and status', async () => {
    const rows = await ds.query(
      `SELECT reference_number, status, fee_state, source FROM admission_applicants ORDER BY reference_number`,
    );
    expect(rows).toEqual(
      STATUSES.map((status, i) => ({
        reference_number: `ADM-2026-${i}`,
        status,
        fee_state: 'NONE',
        source: 'ONLINE',
      })),
    );
  });

  it('gives the old round one NONE stage, APPLY_ONLY, class and year', async () => {
    const stages = await ds.query(
      `SELECT kind, position FROM admission_stages WHERE intake_id = $1`,
      [intakeId],
    );
    expect(stages).toEqual([{ kind: 'NONE', position: 1 }]);
    const [i] = await ds.query(
      `SELECT template_key, class_id, academic_year_id FROM admission_intakes WHERE id = $1`,
      [intakeId],
    );
    expect(i).toEqual({ template_key: 'APPLY_ONLY', class_id: classId, academic_year_id: yearId });
  });

  it('every new table carries tenant_id with an index leading on it', async () => {
    for (const t of [
      'admission_stages',
      'admission_stage_results',
      'admission_lists',
      'admission_list_members',
      'admission_fee_proofs',
    ]) {
      const r = await ds.query(
        `SELECT 1 FROM pg_indexes WHERE tablename = $1 AND indexdef ~ '\\(tenant_id'`,
        [t],
      );
      expect(r.length, t).toBeGreaterThan(0);
    }
  });
});
