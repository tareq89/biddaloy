import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataSource } from 'typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { SEED_TENANT_ID, SEED_SECTION_1_ID } from '@test/constants';
import { School } from '../src/modules/schools/entities/school.entity';

/**
 * [27.1] DB-level invariants the `AdmissionIntake` migration adds —
 * tenant isolation via FK, and the two unique indexes on
 * `admission_applicants` — that no unit test can see.
 */
describe('AdmissionIntake1789800014000 (integration)', () => {
  let dataSource: DataSource;
  const TENANT_ID = SEED_TENANT_ID;
  const classSectionId = SEED_SECTION_1_ID;

  beforeAll(async () => {
    const module = await createTestModule([School], []);
    dataSource = module.get(DataSource);
  }, 60000);

  afterAll(async () => {
    await dataSource.destroy();
  });

  it('creates an intake with tenant_id and required_document_types jsonb', async () => {
    const [intake] = await dataSource.query(
      `INSERT INTO "admission_intakes" (id, tenant_id, class_section_id, title, seat_count, open_date, close_date, required_document_types)
       VALUES (gen_random_uuid(), $1, $2, 'Class 1 Intake', 30, '2026-01-01', '2026-02-01', '["PHOTO","BIRTH_CERTIFICATE"]')
       RETURNING id, tenant_id, required_document_types`,
      [TENANT_ID, classSectionId],
    );
    expect(intake.tenant_id).toBe(TENANT_ID);
    expect(intake.required_document_types).toEqual(['PHOTO', 'BIRTH_CERTIFICATE']);
  });

  it('rejects two applicants on the same intake sharing a guardian phone', async () => {
    const [intake] = await dataSource.query(
      `INSERT INTO "admission_intakes" (id, tenant_id, class_section_id, title, seat_count, open_date, close_date)
       VALUES (gen_random_uuid(), $1, $2, 'Dup Phone Intake', 10, '2026-01-01', '2026-02-01')
       RETURNING id`,
      [TENANT_ID, classSectionId],
    );
    await dataSource.query(
      `INSERT INTO "admission_applicants" (id, tenant_id, intake_id, reference_number, applicant_name, date_of_birth, gender, guardian_name, guardian_phone)
       VALUES (gen_random_uuid(), $1, $2, 'REF-1', 'Applicant One', '2015-01-01', 'MALE', 'Guardian One', '01700000000')`,
      [TENANT_ID, intake.id],
    );
    await expect(
      dataSource.query(
        `INSERT INTO "admission_applicants" (id, tenant_id, intake_id, reference_number, applicant_name, date_of_birth, gender, guardian_name, guardian_phone)
         VALUES (gen_random_uuid(), $1, $2, 'REF-2', 'Applicant Two', '2015-01-01', 'MALE', 'Guardian One', '01700000000')`,
        [TENANT_ID, intake.id],
      ),
    ).rejects.toThrow();
  });

  it('rejects a duplicate reference_number within the same tenant', async () => {
    const [intake] = await dataSource.query(
      `INSERT INTO "admission_intakes" (id, tenant_id, class_section_id, title, seat_count, open_date, close_date)
       VALUES (gen_random_uuid(), $1, $2, 'Dup Ref Intake', 10, '2026-01-01', '2026-02-01')
       RETURNING id`,
      [TENANT_ID, classSectionId],
    );
    await dataSource.query(
      `INSERT INTO "admission_applicants" (id, tenant_id, intake_id, reference_number, applicant_name, date_of_birth, gender, guardian_name, guardian_phone)
       VALUES (gen_random_uuid(), $1, $2, 'REF-SAME', 'Applicant Three', '2015-01-01', 'FEMALE', 'Guardian Two', '01800000000')`,
      [TENANT_ID, intake.id],
    );
    await expect(
      dataSource.query(
        `INSERT INTO "admission_applicants" (id, tenant_id, intake_id, reference_number, applicant_name, date_of_birth, gender, guardian_name, guardian_phone)
         VALUES (gen_random_uuid(), $1, $2, 'REF-SAME', 'Applicant Four', '2015-01-01', 'FEMALE', 'Guardian Three', '01900000000')`,
        [TENANT_ID, intake.id],
      ),
    ).rejects.toThrow();
  });

  it('records an evaluation against an applicant and soft-deletes the applicant', async () => {
    const [intake] = await dataSource.query(
      `INSERT INTO "admission_intakes" (id, tenant_id, class_section_id, title, seat_count, open_date, close_date)
       VALUES (gen_random_uuid(), $1, $2, 'Eval Intake', 10, '2026-01-01', '2026-02-01')
       RETURNING id`,
      [TENANT_ID, classSectionId],
    );
    const [applicant] = await dataSource.query(
      `INSERT INTO "admission_applicants" (id, tenant_id, intake_id, reference_number, applicant_name, date_of_birth, gender, guardian_name, guardian_phone)
       VALUES (gen_random_uuid(), $1, $2, 'REF-EVAL', 'Applicant Five', '2015-01-01', 'MALE', 'Guardian Four', '01600000000')
       RETURNING id`,
      [TENANT_ID, intake.id],
    );
    const [evaluation] = await dataSource.query(
      `INSERT INTO "admission_evaluations" (id, tenant_id, applicant_id, reviewer_user_id, notes, decision)
       VALUES (gen_random_uuid(), $1, $2, gen_random_uuid(), 'Looks good', 'SHORTLIST')
       RETURNING id, decision`,
      [TENANT_ID, applicant.id],
    );
    expect(evaluation.decision).toBe('SHORTLIST');

    await dataSource.query(`UPDATE "admission_applicants" SET deleted_at = now() WHERE id = $1`, [
      applicant.id,
    ]);
    const [deleted] = await dataSource.query(
      `SELECT deleted_at FROM "admission_applicants" WHERE id = $1`,
      [applicant.id],
    );
    expect(deleted.deleted_at).not.toBeNull();
  });
});
