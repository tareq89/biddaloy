import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { ConflictException } from '@nestjs/common';
import { ApplicantReviewService } from './applicant-review.service';
import { AdmissionApplicant } from './entities/admission-applicant.entity';
import { AdmissionEvaluation } from './entities/admission-evaluation.entity';

/** [71.G1.08] Real intake row lock: admits never exceed the seats, OFFERED holds one. */
describe('ApplicantReviewService.admit seats (integration)', () => {
  let ds: DataSource;
  let service: ApplicantReviewService;
  let tenant: string;
  let intake: string;
  let user: string;
  let n = 0;

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    ds = module.get(getDataSourceToken());
    service = new ApplicantReviewService(
      ds.getRepository(AdmissionApplicant),
      ds.getRepository(AdmissionEvaluation),
      { create: async () => ({ id: 'student' }) } as never,
      { findByPhoneAnyFormat: async () => null, create: async () => ({ id: 'g' }) } as never,
      { notifyStatusChange: async () => undefined } as never,
      {} as never,
      { record: async () => undefined } as never,
    );
  }, 60000);

  beforeEach(async () => {
    const [{ id }] = await ds.query(
      `INSERT INTO schools (id, name, slug) VALUES (gen_random_uuid(), 'Seat Int', 'seat-int-' || substr(gen_random_uuid()::text, 1, 8)) RETURNING id`,
    );
    tenant = id;
    const [u] = await ds.query(
      `INSERT INTO users (id, email, password_hash, full_name, status) VALUES (gen_random_uuid(), 'seat-' || substr(gen_random_uuid()::text, 1, 8) || '@x.test', 'x', 'U', 'ACTIVE') RETURNING id`,
    );
    user = u.id;
    const [yr] = await ds.query(
      `INSERT INTO academic_years (name, start_date, end_date, is_current, tenant_id) VALUES ('y', '2026-01-01', '2026-12-31', false, $1) RETURNING id`,
      [id],
    );
    const [c] = await ds.query(
      `INSERT INTO classes (name, numeric_grade, academic_year_id, tenant_id) VALUES ('Six', 6, $1, $2) RETURNING id`,
      [yr.id, id],
    );
    const [s] = await ds.query(
      `INSERT INTO class_sections (class_id, section_name, tenant_id) VALUES ($1, 'A', $2) RETURNING id`,
      [c.id, id],
    );
    const [i] = await ds.query(
      `INSERT INTO admission_intakes (tenant_id, class_section_id, title, seat_count, open_date, close_date)
       VALUES ($1, $2, 'i', 2, '2026-01-01', '2026-12-31') RETURNING id`,
      [id, s.id],
    );
    intake = i.id;
  });

  afterEach(async () => {
    for (const t of [
      'admission_evaluations',
      'admission_applicants',
      'admission_intakes',
      'class_sections',
      'classes',
      'academic_years',
    ])
      await ds.query(`DELETE FROM ${t} WHERE tenant_id = $1`, [tenant]);
    await ds.query(`DELETE FROM schools WHERE id = $1`, [tenant]);
    await ds.query(`DELETE FROM users WHERE id = $1`, [user]);
  });

  afterAll(async () => {
    await ds.destroy();
  });

  async function applicant(status: string): Promise<string> {
    n += 1;
    const [r] = await ds.query(
      `INSERT INTO admission_applicants
         (tenant_id, intake_id, reference_number, applicant_name, date_of_birth, gender,
          guardian_name, guardian_phone, status)
       VALUES ($1, $2, $3, $5, '2015-01-01', 'MALE', 'G', '01700000000', $4) RETURNING id`,
      [tenant, intake, `ADM-S-${n}-${Date.now()}`, status, `Kid ${n}`],
    );
    return r.id;
  }
  const count = async (status: string) =>
    Number(
      (
        await ds.query(
          `SELECT count(*) AS c FROM admission_applicants WHERE intake_id = $1 AND status = $2`,
          [intake, status],
        )
      )[0].c,
    );

  it('concurrent admits never exceed the seats, counting OFFERED', async () => {
    await applicant('OFFERED'); // holds 1 of 2 seats
    const ids = await Promise.all([1, 2, 3, 4].map(() => applicant('PENDING')));
    const results = await Promise.allSettled(ids.map((id) => service.admit(id, {}, tenant, user)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await count('ADMITTED')).toBe(1);
    expect(await count('ADMITTED')).toBeLessThanOrEqual(2 - (await count('OFFERED')));
  });

  it('an OFFERED applicant admits at full capacity while a PENDING one is refused', async () => {
    const offered = await applicant('OFFERED');
    await applicant('ADMITTED'); // 1 admitted + 1 offered == 2 seats
    const pending = await applicant('PENDING');
    await expect(service.admit(pending, {}, tenant, user)).rejects.toThrow(ConflictException);
    await service.admit(offered, {}, tenant, user);
    expect(await count('ADMITTED')).toBe(2);
  });
});
