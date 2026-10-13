import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AppModule } from '../../app.module';
import { SEED_TENANT_ID, SEED_SECTION_1_ID } from '@test/constants';

/**
 * [68.3 LIFE-10] DB-level cover for the per-child unique index
 * `IDX_admission_applicants_intake_child`: the last line of defence behind
 * the service's duplicate lookup.
 */
describe('Admission applicant per-child index (integration)', () => {
  let app: TestingModule;
  let dataSource: DataSource;
  let intakeId: string;
  let n = 0;

  function insert(name: string, dob: string, phone = '8801700000001') {
    return dataSource.query(
      `INSERT INTO admission_applicants
         (id, tenant_id, intake_id, reference_number, applicant_name, date_of_birth, gender,
          guardian_name, guardian_phone, documents, status, created_at, updated_at)
       VALUES (DEFAULT, $1, $2, $3, $4, $5::date, 'MALE', 'Karim', $6, '[]'::jsonb, 'PENDING', NOW(), NOW())`,
      [SEED_TENANT_ID, intakeId, `ADM-2026-DUP${n++}`, name, dob, phone],
    );
  }

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL must be set to run integration tests');
    }
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-production';
    process.env.NODE_ENV = 'test';
    app = await Test.createTestingModule({ imports: [AppModule] }).compile();
    dataSource = app.get(DataSource);
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await dataSource.query(`DELETE FROM admission_applicants WHERE tenant_id = $1`, [
      SEED_TENANT_ID,
    ]);
    await dataSource.query(`DELETE FROM admission_intakes WHERE tenant_id = $1`, [SEED_TENANT_ID]);
    const res = await dataSource.query(
      `INSERT INTO admission_intakes
         (id, tenant_id, class_section_id, title, seat_count, open_date, close_date, required_document_types, created_at, updated_at)
       VALUES (DEFAULT, $1, $2, 'Dup test', 5, '2026-01-01', '2099-12-31', '[]'::jsonb, NOW(), NOW())
       RETURNING id`,
      [SEED_TENANT_ID, SEED_SECTION_1_ID],
    );
    intakeId = res[0].id;
  });

  it('two applicants with the same phone and DOB but different names both insert', async () => {
    await insert('Rahim Uddin', '2018-05-01');
    await insert('Karima Uddin', '2018-05-01');
    const rows = await dataSource.query(`SELECT 1 FROM admission_applicants WHERE intake_id = $1`, [
      intakeId,
    ]);
    expect(rows).toHaveLength(2);
  });

  it('the same (phone, DOB, name) twice in one intake fails with 23505', async () => {
    await insert('Rahim Uddin', '2018-05-01');
    await expect(insert('Rahim Uddin', '2018-05-01')).rejects.toMatchObject({ code: '23505' });
  });
});
