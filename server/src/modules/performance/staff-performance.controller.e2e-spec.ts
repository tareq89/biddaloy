import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { UserRole } from '@biddaloy/shared';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
  SEED_ADMIN_USER_ID,
  SEED_SECTION_1_ID,
  SEED_ACADEMIC_YEAR_ID,
} from '@test/constants';

/**
 * [28.3.6] GET /performance/staff/:userId (ACR_READ = ADMIN only).
 * Privacy contract: subject 404, survey average sealed (CLOSED + min-N), no
 * respondent identity in the payload, tenant isolation.
 */
const API = '/api/v1';
const TENANT_B = '00000000-0000-4000-8000-0000001f1001';
const TEACHER_USER = '00000000-0000-4000-8000-0000001f1010';
const TEACHER_EMAIL = 'staffperf-teacher@e2e.example';
const NON_TEACHER_USER = '00000000-0000-4000-8000-0000001f1011';
const B_STAFF_USER = '00000000-0000-4000-8000-0000001f1012';
const RESPONDENTS = [
  '00000000-0000-4000-8000-0000001f1020',
  '00000000-0000-4000-8000-0000001f1021',
  SEED_ADMIN_USER_ID,
];

describe('staff performance (28.3.6)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let adminToken: string;
  let teacherToken: string;
  let teacherId: string;
  let subjectId: string;

  const year = `academicYearId=${SEED_ACADEMIC_YEAR_ID}`;
  const get = (userId: string, token: string, role: UserRole) =>
    supertest(app.getHttpServer())
      .get(`${API}/performance/staff/${userId}?${year}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .set('X-Role', role);

  async function login(email: string): Promise<string> {
    const res = await supertest(app.getHttpServer())
      .post(`${API}/auth/login`)
      .send({ email, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    return res.body.access_token;
  }

  async function addUser(id: string, email: string, tenantId: string, role: UserRole) {
    await ds.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'StaffPerf E2E User', 'ACTIVE', NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [id, email, SEED_ADMIN_PASSWORD_HASH],
    );
    await ds.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [id, tenantId, role],
    );
  }

  /** CLOSED/OPEN survey about the teacher with `n` respondents, all giving `stars` on one question. */
  async function seedSurvey(
    status: 'OPEN' | 'CLOSED',
    minResponses: number,
    n: number,
    stars: number,
  ) {
    const surveyId = randomUUID();
    const questionId = randomUUID();
    await ds.query(
      `INSERT INTO surveys (id, tenant_id, title, status, anonymous, respondent, min_responses, created_at, updated_at)
       VALUES ($1, $2, 'Term feedback', $3, true, 'BOTH', $4, NOW(), NOW())`,
      [surveyId, SEED_TENANT_ID, status, minResponses],
    );
    await ds.query(
      `INSERT INTO survey_questions (id, tenant_id, survey_id, sort_order, text, stars_enabled)
       VALUES ($1, $2, $3, 0, 'Explains clearly?', true)`,
      [questionId, SEED_TENANT_ID, surveyId],
    );
    await ds.query(
      `INSERT INTO survey_targets (id, tenant_id, survey_id, teacher_id, subject_id)
       VALUES (gen_random_uuid(), $1, $2, $3, $4)`,
      [SEED_TENANT_ID, surveyId, teacherId, subjectId],
    );
    for (const respondent of RESPONDENTS.slice(0, n)) {
      const responseId = randomUUID();
      await ds.query(
        `INSERT INTO survey_responses (id, tenant_id, survey_id, respondent_user_id, teacher_id, subject_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [responseId, SEED_TENANT_ID, surveyId, respondent, teacherId, subjectId],
      );
      await ds.query(
        `INSERT INTO survey_answers (id, tenant_id, response_id, question_id, stars)
         VALUES (gen_random_uuid(), $1, $2, $3, $4)`,
        [SEED_TENANT_ID, responseId, questionId, stars],
      );
    }
  }

  beforeAll(async () => {
    const fixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = fixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    ds = app.get(DataSource);

    await ds.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, 'StaffPerf Other School', 'staffperf-other-school', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [TENANT_B],
    );
    await addUser(TEACHER_USER, TEACHER_EMAIL, SEED_TENANT_ID, UserRole.TEACHER);
    await addUser(
      NON_TEACHER_USER,
      'staffperf-acct@e2e.example',
      SEED_TENANT_ID,
      UserRole.ACCOUNTANT,
    );
    await addUser(B_STAFF_USER, 'staffperf-b@e2e.example', TENANT_B, UserRole.TEACHER);
    await addUser(RESPONDENTS[0], 'staffperf-r1@e2e.example', SEED_TENANT_ID, UserRole.PARENT);
    await addUser(RESPONDENTS[1], 'staffperf-r2@e2e.example', SEED_TENANT_ID, UserRole.PARENT);
    adminToken = await login(SEED_ADMIN_EMAIL);
    teacherToken = await login(TEACHER_EMAIL);
  }, 120000);

  afterAll(async () => {
    await app.close();
  });

  // Transactional tables are wiped before every test, so reseed each time.
  beforeEach(async () => {
    teacherId = randomUUID();
    subjectId = randomUUID();
    await ds.query(
      `INSERT INTO subjects (id, tenant_id, name_en, code, created_at, updated_at)
       VALUES ($1, $2, 'StaffPerf Subject', $3, NOW(), NOW())`,
      [subjectId, SEED_TENANT_ID, `SP-${randomUUID().slice(0, 8)}`],
    );
    await ds.query(
      `WITH sp AS (
         INSERT INTO staff_profiles (id, user_id, tenant_id, employee_id, created_at, updated_at)
         VALUES (gen_random_uuid(), $2::uuid, $3::uuid, 'EMP-SP-1', NOW(), NOW())
         ON CONFLICT (user_id) DO UPDATE SET updated_at = NOW()
         RETURNING id
       )
       INSERT INTO teachers (id, user_id, employee_id, designations, tenant_id, staff_profile_id, created_at, updated_at)
       SELECT $1::uuid, $2::uuid, 'E2E-SP-T', '{}', $3::uuid, sp.id, NOW(), NOW() FROM sp`,
      [teacherId, TEACHER_USER, SEED_TENANT_ID],
    );
    await ds.query(
      `INSERT INTO teacher_class_sections (id, teacher_id, section_id, subject_id, tenant_id, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [randomUUID(), teacherId, SEED_SECTION_1_ID, subjectId, SEED_TENANT_ID],
    );
  });

  it('ADMIN gets 200 with the four blocks and one class for the teacher', async () => {
    await ds.query(
      `INSERT INTO staff_incidents (tenant_id, staff_user_id, type, severity, body, occurred_on, reported_by)
       VALUES ($1, $2, 'BEHAVIOUR', 'LOW', 'e2e body', '2026-09-30', $3)`,
      [SEED_TENANT_ID, TEACHER_USER, SEED_ADMIN_USER_ID],
    );
    const res = await get(TEACHER_USER, adminToken, UserRole.ADMIN).expect(200);
    expect(res.body.userId).toBe(TEACHER_USER);
    expect(res.body.acr).toEqual([]);
    expect(res.body.incidentCount).toBe(1);
    expect(res.body.classes).toHaveLength(1);
    // The incident text must not leak.
    expect(JSON.stringify(res.body)).not.toContain('e2e body');
  });

  it('non-teacher staff gets 200 with classes: []', async () => {
    const res = await get(NON_TEACHER_USER, adminToken, UserRole.ADMIN).expect(200);
    expect(res.body.classes).toEqual([]);
  });

  it('TEACHER is denied (RolesGuard 401)', async () => {
    // RolesGuard answers a role mismatch with 401 (same as the ACR routes); the ticket's "403" is that denial.
    await get(TEACHER_USER, teacherToken, UserRole.TEACHER).expect(401);
  });

  it('the subject gets 404 on their own record (D2)', async () => {
    // Seed admin is the caller here, so asking about the admin's own id is "own record".
    await get(SEED_ADMIN_USER_ID, adminToken, UserRole.ADMIN).expect(404);
  });

  it('unknown user is 404', async () => {
    await get(randomUUID(), adminToken, UserRole.ADMIN).expect(404);
  });

  it('cross-tenant staff user is 404', async () => {
    await get(B_STAFF_USER, adminToken, UserRole.ADMIN).expect(404);
  });

  it('old-year section is not listed when viewing another year', async () => {
    const oldYear = randomUUID();
    const oldClass = randomUUID();
    const oldSection = randomUUID();
    await ds.query(
      `INSERT INTO academic_years (id, name, start_date, end_date, is_current, tenant_id, created_at, updated_at)
       VALUES ($1, 'Old-Year', '2020-01-01', '2020-12-31', false, $2, NOW(), NOW())`,
      [oldYear, SEED_TENANT_ID],
    );
    await ds.query(
      `INSERT INTO classes (id, name, academic_year_id, tenant_id, created_at, updated_at)
       VALUES ($1, 'Old-Class', $2, $3, NOW(), NOW())`,
      [oldClass, oldYear, SEED_TENANT_ID],
    );
    await ds.query(
      `INSERT INTO class_sections (id, section_name, class_id, tenant_id, created_at, updated_at)
       VALUES ($1, 'Old-Sec', $2, $3, NOW(), NOW())`,
      [oldSection, oldClass, SEED_TENANT_ID],
    );
    await ds.query(
      `INSERT INTO teacher_class_sections (id, teacher_id, section_id, subject_id, tenant_id, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [randomUUID(), teacherId, oldSection, subjectId, SEED_TENANT_ID],
    );
    const cur = await get(TEACHER_USER, adminToken, UserRole.ADMIN).expect(200);
    expect(cur.body.classes).toHaveLength(1);
    expect(cur.body.classes[0].classId).not.toBe(oldClass);
    const old = await supertest(app.getHttpServer())
      .get(`${API}/performance/staff/${TEACHER_USER}?academicYearId=${oldYear}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .set('X-Role', UserRole.ADMIN)
      .expect(200);
    expect(old.body.classes.map((c: { classId: string }) => c.classId)).toEqual([oldClass]);
  });

  it('missing X-Tenant-ID is 401, invalid X-Tenant-ID is rejected', async () => {
    await supertest(app.getHttpServer())
      .get(`${API}/performance/staff/${TEACHER_USER}?${year}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(401);
    await supertest(app.getHttpServer())
      .get(`${API}/performance/staff/${TEACHER_USER}?${year}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', randomUUID())
      .expect(401);
  });

  it('per-question gate: a question with fewer star answers than min-N is left out; text-only answers are not counted', async () => {
    await seedSurvey('CLOSED', 2, 3, 4); // q1: 3 star answers of 4 -> avg 4
    const surveyId = (await ds.query(`SELECT id FROM surveys ORDER BY created_at DESC LIMIT 1`))[0]
      .id;
    const responses: { id: string }[] = await ds.query(
      `SELECT id FROM survey_responses WHERE survey_id = $1`,
      [surveyId],
    );
    const sparse = randomUUID();
    const textOnly = randomUUID();
    for (const [q, text] of [
      [sparse, null],
      [textOnly, 'nice'],
    ] as const) {
      await ds.query(
        `INSERT INTO survey_questions (id, tenant_id, survey_id, sort_order, text, stars_enabled)
         VALUES ($1, $2, $3, $4, 'extra', true)`,
        [q, SEED_TENANT_ID, surveyId, q === sparse ? 1 : 2],
      );
    }
    // Only ONE respondent rated the sparse question (5 stars): below min-N 2, must not count.
    await ds.query(
      `INSERT INTO survey_answers (id, tenant_id, response_id, question_id, stars)
       VALUES (gen_random_uuid(), $1, $2, $3, 5)`,
      [SEED_TENANT_ID, responses[0].id, sparse],
    );
    // Everyone left a text-only answer (no stars): must not count as stars.
    for (const r of responses) {
      await ds.query(
        `INSERT INTO survey_answers (id, tenant_id, response_id, question_id, text)
         VALUES (gen_random_uuid(), $1, $2, $3, $4)`,
        [SEED_TENANT_ID, r.id, textOnly, 'nice'],
      );
    }
    const res = await get(TEACHER_USER, adminToken, UserRole.ADMIN).expect(200);
    expect(res.body.survey).toEqual({ averageStars: 4, surveyCount: 1 });
  });

  it('missing academicYearId is 400', async () => {
    await supertest(app.getHttpServer())
      .get(`${API}/performance/staff/${TEACHER_USER}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .set('X-Role', UserRole.ADMIN)
      .expect(400);
  });

  it('survey average omitted below min-N', async () => {
    await seedSurvey('CLOSED', 3, 2, 5); // 2 responses, min 3
    const res = await get(TEACHER_USER, adminToken, UserRole.ADMIN).expect(200);
    expect(res.body.survey).toEqual({ averageStars: null, surveyCount: 0 });
  });

  it('survey average omitted while the survey is not CLOSED', async () => {
    await seedSurvey('OPEN', 1, 3, 5);
    const res = await get(TEACHER_USER, adminToken, UserRole.ADMIN).expect(200);
    expect(res.body.survey.averageStars).toBeNull();
  });

  it('survey average shown once CLOSED and min-N met; below-min survey does not contaminate it', async () => {
    await seedSurvey('CLOSED', 3, 3, 4); // sealed-open: avg 4
    await seedSurvey('CLOSED', 3, 2, 1); // below min: must be ignored entirely
    const res = await get(TEACHER_USER, adminToken, UserRole.ADMIN).expect(200);
    expect(res.body.survey).toEqual({ averageStars: 4, surveyCount: 1 });
  });

  it('no respondent identity or timestamp in the response', async () => {
    await seedSurvey('CLOSED', 2, 3, 3);
    const res = await get(TEACHER_USER, adminToken, UserRole.ADMIN).expect(200);
    const body = JSON.stringify(res.body);
    for (const r of RESPONDENTS) expect(body).not.toContain(r);
    expect(body).not.toMatch(/respondent/i);
    expect(Object.keys(res.body.survey).sort()).toEqual(['averageStars', 'surveyCount']);
  });
});
