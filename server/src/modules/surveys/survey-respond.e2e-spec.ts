import { randomUUID } from 'crypto';
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
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
  SEED_ADMIN_PASSWORD_HASH,
  SEED_SECTION_1_ID,
  SEED_SECTION_2_ID,
} from '@test/constants';

/**
 * [28.4.2] Survey respond + results.
 *
 * Cast (tenant A):
 * - guardianTaught    PARENT of a student in SECTION_1, where the target teacher teaches the subject
 * - guardianNotTaught PARENT of a student in SECTION_2, where nobody teaches it
 * - studentUser       STUDENT, enrolled in SECTION_1
 * - teacherUser       TEACHER, the survey's target teacher (gets 404 on results)
 * - admin (seed)      ADMIN, holds ACR_READ
 */
const API = '/api/v1';
const TENANT_B = '00000000-0000-4000-8000-00000028b001';

const GUARDIAN_TAUGHT = '00000000-0000-4000-8000-00000028a001';
const GUARDIAN_NOT_TAUGHT = '00000000-0000-4000-8000-00000028a002';
const STUDENT_USER = '00000000-0000-4000-8000-00000028a003';
const TEACHER_USER = '00000000-0000-4000-8000-00000028a004';

const EMAILS: Record<string, string> = {
  [GUARDIAN_TAUGHT]: 'svy-guardian-taught@e2e.example',
  [GUARDIAN_NOT_TAUGHT]: 'svy-guardian-not-taught@e2e.example',
  [STUDENT_USER]: 'svy-student@e2e.example',
  [TEACHER_USER]: 'svy-teacher@e2e.example',
};

describe('[28.4.2] Survey respond and results', () => {
  let app: INestApplication;
  let ds: DataSource;
  const tokens: Record<string, string> = {};
  let adminToken: string;

  let teacherId: string;
  let subjectId: string;
  let surveyId: string; // min_responses 1, BOTH
  let hiddenSurveyId: string; // min_responses 5
  let guardiansOnlyId: string;
  let questionId: string;

  const call = (
    method: 'get' | 'post',
    path: string,
    token: string,
    role: UserRole,
    tenant = SEED_TENANT_ID,
  ) =>
    supertest(app.getHttpServer())
      [method](`${API}${path}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', tenant)
      .set('X-Role', role);

  const answer = () => ({
    teacherId,
    subjectId,
    answers: [{ questionId, stars: 4, text: 'Explains well' }],
  });

  const login = async (email: string, password = SEED_ADMIN_PASSWORD) =>
    (
      await supertest(app.getHttpServer())
        .post(`${API}/auth/login`)
        .send({ email, password })
        .expect(200)
    ).body.access_token as string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    await app.listen(0);
    ds = app.get(DataSource);

    const roles: [string, UserRole][] = [
      [GUARDIAN_TAUGHT, UserRole.PARENT],
      [GUARDIAN_NOT_TAUGHT, UserRole.PARENT],
      [STUDENT_USER, UserRole.STUDENT],
      [TEACHER_USER, UserRole.TEACHER],
    ];
    for (const [id, role] of roles) {
      await ds.query(
        `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'ACTIVE', NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [id, EMAILS[id], SEED_ADMIN_PASSWORD_HASH, `Survey ${role} PRIVATE-NAME`],
      );
      await ds.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [id, SEED_TENANT_ID, role],
      );
      tokens[id] = await login(EMAILS[id]);
    }
    adminToken = await login(SEED_ADMIN_EMAIL);
    await ds.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, 'Survey Tenant B', 'survey-tenant-b', NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [TENANT_B],
    );
  }, 120000);

  afterAll(async () => {
    await app.close();
  });

  /** The global beforeEach truncates transactional tables, so rebuild them per test. */
  beforeEach(async () => {
    teacherId = randomUUID();
    subjectId = randomUUID();
    await ds.query(
      `INSERT INTO subjects (id, tenant_id, name_en, code, created_at, updated_at)
       VALUES ($1, $2, 'Survey Subject', $3, NOW(), NOW())`,
      [subjectId, SEED_TENANT_ID, `SRV-${randomUUID().slice(0, 8)}`],
    );
    await ds.query(
      `WITH sp AS (
         INSERT INTO staff_profiles (id, user_id, tenant_id, employee_id, created_at, updated_at)
         VALUES (gen_random_uuid(), $2::uuid, $3::uuid, 'EMP-SRV-1', NOW(), NOW())
         ON CONFLICT (user_id) DO UPDATE SET updated_at = NOW()
         RETURNING id
       )
       INSERT INTO teachers (id, user_id, employee_id, designations, tenant_id, staff_profile_id, created_at, updated_at)
       SELECT $1::uuid, $2::uuid, 'E2E-SRV-T', '{}', $3::uuid, sp.id, NOW(), NOW() FROM sp`,
      [teacherId, TEACHER_USER, SEED_TENANT_ID],
    );
    await ds.query(
      `INSERT INTO teacher_class_sections (id, teacher_id, section_id, subject_id, tenant_id, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [randomUUID(), teacherId, SEED_SECTION_1_ID, subjectId, SEED_TENANT_ID],
    );

    const student = async (sectionId: string, userId: string | null) =>
      (
        await ds.query(
          `INSERT INTO students (full_name, registration_number, roll_number, class_section_id, tenant_id,
              user_id, enrollment_status, preferred_communication, created_at, updated_at)
           VALUES ('Pupil', $1, $2, $3, $4, $5, 'ACTIVE', 'SMS', NOW(), NOW()) RETURNING id`,
          [
            `SRV-${randomUUID().slice(0, 10)}`,
            Math.floor(Math.random() * 1000000),
            sectionId,
            SEED_TENANT_ID,
            userId,
          ],
        )
      )[0].id as string;
    const taughtStudent = await student(SEED_SECTION_1_ID, null);
    const notTaughtStudent = await student(SEED_SECTION_2_ID, null);
    await student(SEED_SECTION_1_ID, STUDENT_USER);

    for (const [userId, studentId] of [
      [GUARDIAN_TAUGHT, taughtStudent],
      [GUARDIAN_NOT_TAUGHT, notTaughtStudent],
    ]) {
      const g = await ds.query(
        `INSERT INTO guardians (full_name, relationship, phone, email, tenant_id, user_id,
                                preferred_communication, is_primary_contact, created_at, updated_at)
         VALUES ('Guardian', 'FATHER', '+8801700000000', $1, $2, $3, 'SMS', true, NOW(), NOW())
         RETURNING id`,
        [`g-${randomUUID().slice(0, 8)}@e2e.example`, SEED_TENANT_ID, userId],
      );
      await ds.query(`INSERT INTO student_guardians (student_id, guardian_id) VALUES ($1, $2)`, [
        studentId,
        g[0].id,
      ]);
    }

    const makeSurvey = async (respondent: string, minResponses: number) => {
      const id = randomUUID();
      await ds.query(
        `INSERT INTO surveys (id, tenant_id, title, status, anonymous, respondent, min_responses, created_at, updated_at)
         VALUES ($1, $2, 'Term feedback', 'OPEN', true, $3, $4, NOW(), NOW())`,
        [id, SEED_TENANT_ID, respondent, minResponses],
      );
      const q = randomUUID();
      await ds.query(
        `INSERT INTO survey_questions (id, tenant_id, survey_id, sort_order, text, stars_enabled)
         VALUES ($1, $2, $3, 0, 'Explains clearly?', true)`,
        [q, SEED_TENANT_ID, id],
      );
      await ds.query(
        `INSERT INTO survey_targets (id, tenant_id, survey_id, teacher_id, subject_id)
         VALUES (gen_random_uuid(), $1, $2, $3, $4)`,
        [SEED_TENANT_ID, id, teacherId, subjectId],
      );
      return { id, q };
    };
    const a = await makeSurvey('BOTH', 1);
    surveyId = a.id;
    questionId = a.q;
    hiddenSurveyId = (await makeSurvey('BOTH', 5)).id;
    guardiansOnlyId = (await makeSurvey('GUARDIANS', 1)).id;
  });

  const respondPath = (id: string) => `/surveys/${id}/respond`;

  it('guardian of a taught student sees the pair in /mine, answers once, then gets 409', async () => {
    const t = tokens[GUARDIAN_TAUGHT];
    const mine = await call('get', '/surveys/mine', t, UserRole.PARENT).expect(200);
    const s = mine.body.find((x: { id: string }) => x.id === surveyId);
    expect(s.pending).toEqual([{ teacherId, subjectId }]);

    await call('post', respondPath(surveyId), t, UserRole.PARENT).send(answer()).expect(201);
    await call('post', respondPath(surveyId), t, UserRole.PARENT).send(answer()).expect(409);

    const after = await call('get', '/surveys/mine', t, UserRole.PARENT).expect(200);
    expect(after.body.find((x: { id: string }) => x.id === surveyId)).toBeUndefined();
  });

  it('guardian of a NON-taught student gets 403', async () => {
    await call('post', respondPath(surveyId), tokens[GUARDIAN_NOT_TAUGHT], UserRole.PARENT)
      .send(answer())
      .expect(403);
    const mine = await call(
      'get',
      '/surveys/mine',
      tokens[GUARDIAN_NOT_TAUGHT],
      UserRole.PARENT,
    ).expect(200);
    expect(mine.body).toEqual([]);
  });

  it('a student answers a BOTH survey but gets 403 on a GUARDIANS-only one', async () => {
    const t = tokens[STUDENT_USER];
    await call('post', respondPath(surveyId), t, UserRole.STUDENT).send(answer()).expect(201);
    await call('post', respondPath(guardiansOnlyId), t, UserRole.STUDENT)
      .send(answer())
      .expect(403);
  });

  it('rejects a bad payload: stars out of range, unknown question', async () => {
    const t = tokens[GUARDIAN_TAUGHT];
    const bad = { ...answer(), answers: [{ questionId, stars: 9 }] };
    await call('post', respondPath(surveyId), t, UserRole.PARENT).send(bad).expect(400);
    const unknown = { ...answer(), answers: [{ questionId: randomUUID(), stars: 3 }] };
    await call('post', respondPath(surveyId), t, UserRole.PARENT).send(unknown).expect(400);
  });

  it('two concurrent posts from one respondent: exactly one 201 and one 409', async () => {
    const t = tokens[GUARDIAN_TAUGHT];
    const fire = () =>
      call('post', respondPath(surveyId), t, UserRole.PARENT)
        .send(answer())
        .then((r) => r.status);
    const statuses = (await Promise.all([fire(), fire()])).sort();
    expect(statuses).toEqual([201, 409]);
    const rows = await ds.query(
      `SELECT COUNT(*)::int AS n FROM survey_responses WHERE survey_id = $1`,
      [surveyId],
    );
    expect(rows[0].n).toBe(1);
  });

  it('teacher gets 404 (not 403) on the results of a survey targeting them', async () => {
    await call(
      'get',
      `/surveys/${surveyId}/results`,
      tokens[TEACHER_USER],
      UserRole.TEACHER,
    ).expect(404);
  });

  it('family callers are refused on results (RolesGuard answers 401); unknown survey 404s for admin', async () => {
    await call(
      'get',
      `/surveys/${surveyId}/results`,
      tokens[GUARDIAN_TAUGHT],
      UserRole.PARENT,
    ).expect(401);
    await call('get', `/surveys/${randomUUID()}/results`, adminToken, UserRole.ADMIN).expect(404);
  });

  it('a survey in another tenant is a 404 for respond and results', async () => {
    const foreign = randomUUID();
    await ds.query(
      `INSERT INTO surveys (id, tenant_id, title, status, anonymous, respondent, min_responses, created_at, updated_at)
       VALUES ($1, $2, 'Foreign', 'OPEN', true, 'BOTH', 1, NOW(), NOW())`,
      [foreign, TENANT_B],
    );
    await call('post', respondPath(foreign), tokens[GUARDIAN_TAUGHT], UserRole.PARENT)
      .send(answer())
      .expect(404);
    await call('get', `/surveys/${foreign}/results`, adminToken, UserRole.ADMIN).expect(404);
  });

  it('below min_responses: admin sees only {teacherId, subjectId, count, hidden}', async () => {
    await call('post', respondPath(hiddenSurveyId), tokens[GUARDIAN_TAUGHT], UserRole.PARENT)
      .send({
        ...answer(),
        answers: [{ questionId: await firstQuestion(hiddenSurveyId), stars: 2 }],
      })
      .expect(201);
    await closeSurvey(hiddenSurveyId);
    const res = await call(
      'get',
      `/surveys/${hiddenSurveyId}/results`,
      adminToken,
      UserRole.ADMIN,
    ).expect(200);
    expect(res.body.results).toEqual([{ teacherId, subjectId, count: 1, hidden: true }]);
  });

  it('at min_responses: averages and comments, and no respondent data anywhere (anonymous)', async () => {
    await call('post', respondPath(surveyId), tokens[GUARDIAN_TAUGHT], UserRole.PARENT)
      .send({ ...answer(), answers: [{ questionId, stars: 4, text: 'zebra comment' }] })
      .expect(201);
    await call('post', respondPath(surveyId), tokens[STUDENT_USER], UserRole.STUDENT)
      .send({ ...answer(), answers: [{ questionId, stars: 5, text: 'alpha comment' }] })
      .expect(201);

    await closeSurvey(surveyId);
    const res = await call(
      'get',
      `/surveys/${surveyId}/results`,
      adminToken,
      UserRole.ADMIN,
    ).expect(200);
    const pair = res.body.results[0];
    expect(pair).toMatchObject({ hidden: false, count: 2 });
    expect(pair.questions[0].averageStars).toBe(4.5);
    // Sorted by text, never by submission order (zebra was posted first).
    expect(pair.questions[0].comments).toEqual(['alpha comment', 'zebra comment']);

    const json = JSON.stringify(res.body);
    for (const secret of [
      GUARDIAN_TAUGHT,
      STUDENT_USER,
      EMAILS[GUARDIAN_TAUGHT],
      'PRIVATE-NAME',
      'respondent',
      'created_at',
      'user_id',
    ]) {
      expect(json).not.toContain(secret);
    }
  });

  it('a question answered by fewer than min_responses people is masked (no average, no comments), and text-only answers do not count toward n', async () => {
    await ds.query(`UPDATE surveys SET min_responses = 2 WHERE id = $1`, [surveyId]);
    const q2 = randomUUID();
    await ds.query(
      `INSERT INTO survey_questions (id, tenant_id, survey_id, sort_order, text, stars_enabled)
       VALUES ($1, $2, $3, 1, 'Fair marking?', true)`,
      [q2, SEED_TENANT_ID, surveyId],
    );
    // The guardian answers both questions; the student skips the second one.
    await call('post', respondPath(surveyId), tokens[GUARDIAN_TAUGHT], UserRole.PARENT)
      .send({
        ...answer(),
        answers: [
          { questionId, stars: 4 },
          { questionId: q2, stars: 1, text: 'identifying comment' },
        ],
      })
      .expect(201);
    await call('post', respondPath(surveyId), tokens[STUDENT_USER], UserRole.STUDENT)
      .send({ ...answer(), answers: [{ questionId, stars: 5 }] })
      .expect(201);
    // q3: stars from ONE response + a comment-only answer from the other.
    // COUNT(*) is 2 but only one person starred: the average must stay sealed.
    const q3 = randomUUID();
    await ds.query(
      `INSERT INTO survey_questions (id, tenant_id, survey_id, sort_order, text, stars_enabled)
       VALUES ($1, $2, $3, 2, 'Helpful?', true)`,
      [q3, SEED_TENANT_ID, surveyId],
    );
    const responses: { id: string }[] = await ds.query(
      `SELECT id FROM survey_responses WHERE survey_id = $1 ORDER BY id`,
      [surveyId],
    );
    expect(responses).toHaveLength(2);
    await ds.query(
      `INSERT INTO survey_answers (id, tenant_id, response_id, question_id, stars, text)
       VALUES ($1, $3, $4, $5, 5, NULL), ($2, $3, $6, $5, NULL, 'comment only')`,
      [randomUUID(), randomUUID(), SEED_TENANT_ID, responses[0].id, q3, responses[1].id],
    );
    await closeSurvey(surveyId);
    const res = await call(
      'get',
      `/surveys/${surveyId}/results`,
      adminToken,
      UserRole.ADMIN,
    ).expect(200);
    const qs = res.body.results[0].questions as {
      questionId: string;
      averageStars: number | null;
      comments: string[];
    }[];
    expect(qs.find((q) => q.questionId === questionId)!.averageStars).toBe(4.5);
    const masked = qs.find((q) => q.questionId === q2)!;
    expect(masked.averageStars).toBeNull();
    expect(masked.comments).toEqual([]);
    expect(JSON.stringify(res.body)).not.toContain('identifying comment');
    const sealed = qs.find((q) => q.questionId === q3)!;
    expect(sealed.averageStars).toBeNull();
    expect(sealed.comments).toEqual([]);
  });

  it('a NAMED (anonymous:false) survey still exposes no respondent field', async () => {
    await ds.query(`UPDATE surveys SET anonymous = false WHERE id = $1`, [surveyId]);
    await call('post', respondPath(surveyId), tokens[GUARDIAN_TAUGHT], UserRole.PARENT)
      .send(answer())
      .expect(201);
    await closeSurvey(surveyId);
    const res = await call(
      'get',
      `/surveys/${surveyId}/results`,
      adminToken,
      UserRole.ADMIN,
    ).expect(200);
    expect(res.body.anonymous).toBe(false);
    const json = JSON.stringify(res.body);
    for (const secret of [GUARDIAN_TAUGHT, EMAILS[GUARDIAN_TAUGHT], 'PRIVATE-NAME', 'respondent']) {
      expect(json).not.toContain(secret);
    }
  });

  it('a NULL-subject (class-teacher) row in the guardian section does not make them eligible', async () => {
    // Teacher is class teacher (no subject) of SECTION_2; does not teach the subject there.
    await ds.query(
      `INSERT INTO teacher_class_sections (id, teacher_id, section_id, subject_id, tenant_id, created_at)
       VALUES ($1, $2, $3, NULL, $4, NOW())`,
      [randomUUID(), teacherId, SEED_SECTION_2_ID, SEED_TENANT_ID],
    );
    await call('post', respondPath(surveyId), tokens[GUARDIAN_NOT_TAUGHT], UserRole.PARENT)
      .send(answer())
      .expect(403);
  });

  it('an ADMIN who is also a target teacher of the survey gets 404 on results', async () => {
    const adminTeacher = randomUUID();
    await ds.query(
      `WITH sp AS (
         INSERT INTO staff_profiles (id, user_id, tenant_id, employee_id, created_at, updated_at)
         VALUES (gen_random_uuid(), $2::uuid, $3::uuid, 'EMP-SRV-ADM', NOW(), NOW())
         ON CONFLICT (user_id) DO UPDATE SET updated_at = NOW()
         RETURNING id
       )
       INSERT INTO teachers (id, user_id, employee_id, designations, tenant_id, staff_profile_id, created_at, updated_at)
       SELECT $1::uuid, $2::uuid, 'E2E-SRV-ADM', '{}', $3::uuid, sp.id, NOW(), NOW() FROM sp`,
      [adminTeacher, SEED_ADMIN_USER_ID, SEED_TENANT_ID],
    );
    await ds.query(
      `INSERT INTO survey_targets (id, tenant_id, survey_id, teacher_id, subject_id)
       VALUES (gen_random_uuid(), $1, $2, $3, $4)`,
      [SEED_TENANT_ID, surveyId, adminTeacher, subjectId],
    );
    await call('get', `/surveys/${surveyId}/results`, adminToken, UserRole.ADMIN).expect(404);
  });

  it('missing or invalid X-Tenant-ID is refused on /mine and /respond', async () => {
    const t = tokens[GUARDIAN_TAUGHT];
    const bare = (method: 'get' | 'post', path: string) =>
      supertest(app.getHttpServer())[method](`${API}${path}`).set('Authorization', `Bearer ${t}`);
    await bare('get', '/surveys/mine').expect(401);
    await bare('post', respondPath(surveyId)).send(answer()).expect(401);
    // A tenant the caller does not belong to.
    await call('get', '/surveys/mine', t, UserRole.PARENT, randomUUID()).expect(401);
    await call('post', respondPath(surveyId), t, UserRole.PARENT, randomUUID())
      .send(answer())
      .expect(401);
  });

  /** Results are only revealed once a survey is CLOSED. */
  const closeSurvey = (id: string) =>
    ds.query(`UPDATE surveys SET status = 'CLOSED' WHERE id = $1`, [id]);

  it('an OPEN survey reveals nothing but {teacherId, subjectId, count, hidden} even past min N', async () => {
    await call('post', respondPath(surveyId), tokens[GUARDIAN_TAUGHT], UserRole.PARENT)
      .send({ ...answer(), answers: [{ questionId, stars: 5, text: 'open-survey comment' }] })
      .expect(201);
    const open = await call(
      'get',
      `/surveys/${surveyId}/results`,
      adminToken,
      UserRole.ADMIN,
    ).expect(200);
    expect(open.body.results).toEqual([{ teacherId, subjectId, count: 1, hidden: true }]);
    expect(JSON.stringify(open.body)).not.toContain('open-survey comment');

    await closeSurvey(surveyId);
    const closed = await call(
      'get',
      `/surveys/${surveyId}/results`,
      adminToken,
      UserRole.ADMIN,
    ).expect(200);
    expect(closed.body.results[0]).toMatchObject({ hidden: false, count: 1 });
  });

  async function firstQuestion(id: string): Promise<string> {
    const rows = await ds.query(`SELECT id FROM survey_questions WHERE survey_id = $1`, [id]);
    return rows[0].id as string;
  }
});
