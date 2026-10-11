import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { UserRole } from '@biddaloy/shared';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_USER_ID,
  SEED_ADMIN_PASSWORD,
  SEED_SECTION_1_ID,
} from '@test/constants';

const OTHER_TENANT_ID = '00000000-0000-4000-8000-000000000998';
const MATCH_PHONE = '8801700000998';

/**
 * [LIFE-09] HTTP coverage for `GET /admission/applicants/:id/guardian-match`
 * and the server-side "no silent link" rule on `POST …/admit`.
 * Denied roles get 403 from PermissionsGuard (ADMISSION_REVIEW is ADMIN-only).
 */
describe('ApplicantReviewController guardian match (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let token: string;
  let applicantId: string;

  const http = () => supertest(app.getHttpServer());
  const as = (req: supertest.Test, role: UserRole, tenantId = SEED_TENANT_ID) =>
    req.set('Authorization', `Bearer ${token}`).set('X-Tenant-ID', tenantId).set('X-Role', role);

  beforeAll(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-production';
    process.env.NODE_ENV = 'test';
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    ds = app.get(DataSource);

    await ds.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, 'Review Other School', 'review-other-school', NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [OTHER_TENANT_ID],
    );
    // The same login is an ADMIN member of tenant B too, so tenant B's admin is a real caller.
    for (const [tenant, role] of [
      [SEED_TENANT_ID, UserRole.TEACHER],
      [OTHER_TENANT_ID, UserRole.ADMIN],
    ]) {
      await ds.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [SEED_ADMIN_USER_ID, tenant, role],
      );
    }
    const login = await http()
      .post('/api/v1/auth/login')
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    token = login.body.access_token;
  }, 60000);

  afterAll(async () => {
    await ds.query(`DELETE FROM user_tenants WHERE tenant_id = $1`, [OTHER_TENANT_ID]);
    await app.close();
  });

  beforeEach(async () => {
    await ds.query(`DELETE FROM admission_evaluations WHERE tenant_id = $1`, [SEED_TENANT_ID]);
    await ds.query(`DELETE FROM admission_applicants WHERE tenant_id = $1`, [SEED_TENANT_ID]);
    await ds.query(`DELETE FROM admission_intakes WHERE tenant_id = $1`, [SEED_TENANT_ID]);
    await ds.query(`DELETE FROM guardians WHERE tenant_id = $1 AND phone = $2`, [
      SEED_TENANT_ID,
      MATCH_PHONE,
    ]);

    await ds.query(
      `INSERT INTO guardians (id, tenant_id, full_name, relationship, phone, created_at, updated_at)
       VALUES (DEFAULT, $1, 'Existing Family Parent', 'OTHER', $2, NOW(), NOW())`,
      [SEED_TENANT_ID, MATCH_PHONE],
    );
    const [intake] = await ds.query(
      `INSERT INTO admission_intakes
         (id, tenant_id, class_section_id, title, seat_count, open_date, close_date, required_document_types, created_at, updated_at)
       VALUES (DEFAULT, $1, $2, 'Review E2E', 5, '2026-01-01', '2099-12-31', '[]'::jsonb, NOW(), NOW())
       RETURNING id`,
      [SEED_TENANT_ID, SEED_SECTION_1_ID],
    );
    const [applicant] = await ds.query(
      `INSERT INTO admission_applicants
         (id, tenant_id, intake_id, reference_number, applicant_name, date_of_birth, gender, guardian_name, guardian_phone, documents, status, created_at, updated_at)
       VALUES (DEFAULT, $1, $2, 'ADM-2026-REVWE2', 'Review Child', '2018-01-01', 'MALE', 'Typed Name', $3, '[]'::jsonb, 'PENDING', NOW(), NOW())
       RETURNING id`,
      [SEED_TENANT_ID, intake.id, MATCH_PHONE],
    );
    applicantId = applicant.id;
  });

  it('ADMIN gets the matched guardian', async () => {
    const res = await as(
      http().get(`/api/v1/admission/applicants/${applicantId}/guardian-match`),
      UserRole.ADMIN,
    ).expect(200);
    expect(res.body.guardian.full_name).toBe('Existing Family Parent');
    expect(res.body.guardian.student_names).toEqual([]);
  });

  it('TEACHER (no ADMISSION_REVIEW) gets 403', async () => {
    await as(
      http().get(`/api/v1/admission/applicants/${applicantId}/guardian-match`),
      UserRole.TEACHER,
    ).expect(403);
  });

  it("tenant B's admin cannot read tenant A's applicant (404)", async () => {
    await as(
      http().get(`/api/v1/admission/applicants/${applicantId}/guardian-match`),
      UserRole.ADMIN,
      OTHER_TENANT_ID,
    ).expect(404);
  });

  it('admit with no choice when a match exists is refused with 409 (API bypass)', async () => {
    const res = await as(
      http().post(`/api/v1/admission/applicants/${applicantId}/admit`),
      UserRole.ADMIN,
    )
      .send({})
      .expect(409);
    expect(res.body.details.code).toBe('GUARDIAN_MATCH_NEEDS_CHOICE');
  });
});
