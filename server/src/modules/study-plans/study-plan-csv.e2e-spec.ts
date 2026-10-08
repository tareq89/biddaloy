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
  SEED_ACADEMIC_YEAR_ID,
  SEED_CLASS_1_ID,
  SEED_CLASS_2_ID,
  SEED_SECTION_1_ID,
  SEED_SECTION_2_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
} from '@test/constants';

/** E2E for lessons.csv, import validate/commit and progress.csv (66.2.07 / #2012). */
const API = '/api/v1';
const TENANT_2 = '00000000-0000-4000-8000-0000007d0002';

const USERS = {
  T: { id: '00000000-0000-4000-8000-0000007d0001', role: UserRole.TEACHER },
  U: { id: '00000000-0000-4000-8000-0000007d0003', role: UserRole.TEACHER },
  H: { id: '00000000-0000-4000-8000-0000007d0004', role: UserRole.TEACHER },
  EXECUTIVE: { id: '00000000-0000-4000-8000-0000007d0005', role: UserRole.EXECUTIVE },
  ACCOUNTANT: { id: '00000000-0000-4000-8000-0000007d0006', role: UserRole.ACCOUNTANT },
  OFFICE_STAFF: { id: '00000000-0000-4000-8000-0000007d0007', role: UserRole.OFFICE_STAFF },
  EXAM_CONTROLLER: { id: '00000000-0000-4000-8000-0000007d0008', role: UserRole.EXAM_CONTROLLER },
  COMMITTEE: { id: '00000000-0000-4000-8000-0000007d0009', role: UserRole.COMMITTEE },
  PARENT: { id: '00000000-0000-4000-8000-0000007d000a', role: UserRole.PARENT },
  STUDENT: { id: '00000000-0000-4000-8000-0000007d000b', role: UserRole.STUDENT },
  ADMIN2: { id: '00000000-0000-4000-8000-0000007d000c', role: UserRole.ADMIN },
} as const;
type Who = keyof typeof USERS;

describe('Study plan CSV E2E (66.2.07)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  const tokens: Record<string, string> = {};
  let adminToken: string;
  let subjectId: string;
  let teacherT: string;
  let teacherU: string;

  const email = (who: string) => `spcsv-e2e-${who.toLowerCase()}@e2e.example`;

  async function login(mail: string): Promise<string> {
    const res = await supertest(app.getHttpServer())
      .post(`${API}/auth/login`)
      .send({ email: mail, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    return res.body.access_token;
  }

  /** Request as `who` in the seed tenant (admin = the seed admin). */
  function as(
    method: 'get' | 'post' | 'put' | 'patch' | 'delete',
    path: string,
    who: Who | 'ADMIN',
    tenant = SEED_TENANT_ID,
  ) {
    const token = who === 'ADMIN' ? adminToken : tokens[who];
    const role = who === 'ADMIN' ? UserRole.ADMIN : USERS[who].role;
    return supertest(app.getHttpServer())
      [method](`${API}${path}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', tenant)
      .set('X-Role', role);
  }

  async function makeTeacher(userId: string, tag: string): Promise<string> {
    const teacherId = randomUUID();
    await dataSource.query(
      `WITH sp AS (
         INSERT INTO staff_profiles (id, user_id, tenant_id, employee_id, created_at, updated_at)
         VALUES (gen_random_uuid(), $2::uuid, $3::uuid, 'EMP-SPCSVE2E-' || $4, NOW(), NOW())
         ON CONFLICT (user_id) DO UPDATE SET updated_at = NOW()
         RETURNING id
       )
       INSERT INTO teachers (id, user_id, employee_id, designations, tenant_id, staff_profile_id, created_at, updated_at)
       SELECT $1::uuid, $2::uuid, 'SPCSVE2E-' || $4, '{}', $3::uuid, sp.id, NOW(), NOW() FROM sp`,
      [teacherId, userId, SEED_TENANT_ID, tag],
    );
    return teacherId;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    dataSource = app.get(DataSource);

    await dataSource.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, 'Tenant Two', 'spcsv-e2e-tenant-two', NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [TENANT_2],
    );
    for (const [who, u] of Object.entries(USERS)) {
      const tenant = who === 'ADMIN2' ? TENANT_2 : SEED_TENANT_ID;
      await dataSource.query(
        `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'ACTIVE', NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [u.id, email(who), SEED_ADMIN_PASSWORD_HASH, `SPCSV E2E ${who}`],
      );
      await dataSource.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [u.id, tenant, u.role],
      );
      tokens[who] = await login(email(who));
    }
    adminToken = await login(SEED_ADMIN_EMAIL);
  }, 120000);

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // Transactional tables are reset between tests: rebuild the fixture.
    subjectId = (
      await dataSource.query(
        `INSERT INTO subjects (id, tenant_id, name_en, code, created_at, updated_at)
         VALUES ($1, $2, 'SPCSV E2E Maths', $3, NOW(), NOW()) RETURNING id`,
        [randomUUID(), SEED_TENANT_ID, `SPC-${randomUUID().slice(0, 8)}`],
      )
    )[0].id;
    for (const classId of [SEED_CLASS_1_ID, SEED_CLASS_2_ID]) {
      await dataSource.query(
        `INSERT INTO class_subjects (id, tenant_id, class_id, subject_id, academic_year_id, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW(), NOW())`,
        [SEED_TENANT_ID, classId, subjectId, SEED_ACADEMIC_YEAR_ID],
      );
    }

    teacherT = await makeTeacher(USERS.T.id, 'T');
    teacherU = await makeTeacher(USERS.U.id, 'U');
    const teacherH = await makeTeacher(USERS.H.id, 'H');
    // H is CLASS_TEACHER (homeroom) of section 1.
    await dataSource.query(
      `INSERT INTO teacher_class_sections (id, teacher_id, section_id, tenant_id, assignment_type, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, 'CLASS_TEACHER', NOW())`,
      [teacherH, SEED_SECTION_1_ID, SEED_TENANT_ID],
    );

    // Published routine slot: T teaches this subject in section 1.
    const [{ id: shiftId }] = await dataSource.query(
      `INSERT INTO shifts (id, tenant_id, name, day_starts_at, day_ends_at, sequence, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, '08:00', '13:00', 0, NOW(), NOW()) RETURNING id`,
      [SEED_TENANT_ID, `SPCSV E2E ${randomUUID().slice(0, 8)}`],
    );
    const [{ id: periodId }] = await dataSource.query(
      `INSERT INTO period_slots (id, tenant_id, shift_id, sequence, kind, name, starts_at, ends_at, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, 1, 'CLASS', 'P1', '08:00', '08:45', NOW(), NOW()) RETURNING id`,
      [SEED_TENANT_ID, shiftId],
    );
    const [{ id: routineId }] = await dataSource.query(
      `INSERT INTO routines (id, tenant_id, academic_year_id, name, state, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, 'SPCSV E2E', 'PUBLISHED', NOW(), NOW()) RETURNING id`,
      [SEED_TENANT_ID, SEED_ACADEMIC_YEAR_ID],
    );
    const [{ id: slotId }] = await dataSource.query(
      `INSERT INTO routine_slots (id, tenant_id, routine_id, section_id, period_slot_id, weekday, subject_id, recurrence, valid_from, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, 1, $5, 'WEEKLY', '2020-01-01', NOW(), NOW()) RETURNING id`,
      [SEED_TENANT_ID, routineId, SEED_SECTION_1_ID, periodId, subjectId],
    );
    await dataSource.query(
      `INSERT INTO routine_slot_teachers (id, tenant_id, routine_slot_id, teacher_id, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, NOW())`,
      [SEED_TENANT_ID, slotId, teacherT],
    );
  });

  // ---------------------------------------------------------------- helpers

  const csvText = (rows: string[]) => `title,periods,topic,notes\r\n${rows.join('\r\n')}`;
  const GOOD = csvText(['"ভগ্নাংশের ধারণা",2,ভগ্নাংশ,""', '"দশমিকের গুণ",1,Unknown topic,note']);
  let subjectCode: string;
  let termId: string;

  async function createPlan(who: Who | 'ADMIN' = 'ADMIN', term: string | null = null) {
    const res = await as('post', '/study-plans', who)
      .send({
        section_id: SEED_SECTION_1_ID,
        subject_id: subjectId,
        academic_term_id: term,
      })
      .expect(201);
    return res.body.id as string;
  }

  /** POST /import/validate as `who` with a CSV and the given form fields. */
  function validate(
    who: Who | 'ADMIN',
    fields: Record<string, string>,
    csv = GOOD,
    tenant?: string,
  ) {
    let req = as('post', '/study-plans/import/validate', who, tenant).attach(
      'file',
      Buffer.from(csv, 'utf-8'),
      { filename: 'lessons.csv', contentType: 'text/csv' },
    );
    for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
    return req;
  }
  const planFields = () => ({ class_id: SEED_CLASS_1_ID, subject_id: subjectId });

  beforeEach(async () => {
    subjectCode = (
      await dataSource.query('SELECT code FROM subjects WHERE id = $1', [subjectId])
    )[0].code;
    await dataSource.query(
      `INSERT INTO syllabus_topics (id, tenant_id, class_id, subject_id, name, sequence, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, 'ভগ্নাংশ', 1, NOW(), NOW())`,
      [SEED_TENANT_ID, SEED_CLASS_1_ID, subjectId],
    );
    const [y] = await dataSource.query(
      'SELECT start_date, end_date FROM academic_years WHERE id = $1',
      [SEED_ACADEMIC_YEAR_ID],
    );
    termId = (
      await dataSource.query(
        `INSERT INTO academic_terms (id, tenant_id, academic_year_id, seq, name, start_date, end_date, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, 903, $3, $4, $5, NOW(), NOW()) RETURNING id`,
        [
          SEED_TENANT_ID,
          SEED_ACADEMIC_YEAR_ID,
          `CSV Term ${randomUUID().slice(0, 4)}`,
          y.start_date,
          y.end_date,
        ],
      )
    )[0].id;
  });

  // ------------------------------------------------------------ lessons.csv

  describe('GET /study-plans/:id/lessons.csv', () => {
    it('owner T, ADMIN and EXECUTIVE get a text/csv download with the plan lessons', async () => {
      const id = await createPlan('T');
      await as('put', `/study-plans/${id}/lessons`, 'T')
        .send({ lessons: [{ title: 'ভগ্নাংশের ধারণা', periods: 2 }] })
        .expect(200);
      for (const who of ['T', 'ADMIN', 'EXECUTIVE'] as const) {
        const res = await as('get', `/study-plans/${id}/lessons.csv`, who).expect(200);
        expect(res.headers['content-type']).toContain('text/csv');
        expect(res.headers['content-disposition']).toContain('attachment');
        expect(res.text).toContain('"title","periods","topic","notes"');
        expect(res.text).toContain('ভগ্নাংশের ধারণা');
      }
    });

    it('an unrelated teacher and a parent get 403', async () => {
      const id = await createPlan('T');
      await as('get', `/study-plans/${id}/lessons.csv`, 'U').expect(403);
      await as('get', `/study-plans/${id}/lessons.csv`, 'PARENT').expect(403);
    });

    it('another tenant admin gets 404; no tenant header context is 401', async () => {
      const id = await createPlan();
      await as('get', `/study-plans/${id}/lessons.csv`, 'ADMIN2', TENANT_2).expect(404);
      await as('get', `/study-plans/${id}/lessons.csv`, 'ADMIN2', SEED_TENANT_ID).expect(401);
      await supertest(app.getHttpServer()).get(`${API}/study-plans/${id}/lessons.csv`).expect(401);
    });
  });

  // ------------------------------------------------------- import: plan targets

  describe('import into a plan', () => {
    it('validate previews rows and warns on an unknown topic; commit replaces the lessons', async () => {
      const id = await createPlan('T');
      const v = await validate('T', planFields()).expect(201);
      expect(v.body).toMatchObject({ rows_to_create: 2, hard_error_count: 0, errors: [] });
      expect(v.body.warnings).toHaveLength(1);

      const c = await as('post', '/study-plans/import/commit', 'T')
        .send({ staging_id: v.body.staging_id, plan_id: id })
        .expect(201);
      expect(c.body.lessons.map((l: { title: string }) => l.title)).toEqual([
        'ভগ্নাংশের ধারণা',
        'দশমিকের গুণ',
      ]);
      // The known topic was linked by name; the unknown one was dropped.
      expect(c.body.lessons[0].topic_id).toBeTruthy();
      expect(c.body.lessons[1].topic_id).toBeUndefined();
    });

    it('a staging id works once', async () => {
      const id = await createPlan('T');
      const v = await validate('T', planFields()).expect(201);
      const body = { staging_id: v.body.staging_id, plan_id: id };
      await as('post', '/study-plans/import/commit', 'T').send(body).expect(201);
      await as('post', '/study-plans/import/commit', 'T').send(body).expect(404);
    });

    it('a refused write keeps the staging id for a retry', async () => {
      const id = await createPlan('ADMIN');
      const v = await validate('ADMIN', planFields()).expect(201);
      // A new plan for the same scope already exists: 409, the upload is not used up.
      await as('post', '/study-plans/import/commit', 'ADMIN')
        .send({
          staging_id: v.body.staging_id,
          plan: { section_id: SEED_SECTION_1_ID, subject_id: subjectId, academic_term_id: null },
        })
        .expect(409);
      await as('post', '/study-plans/import/commit', 'ADMIN')
        .send({ staging_id: v.body.staging_id, plan_id: id })
        .expect(201);
    });

    it('re-importing keeps lesson ids whose titles match, so exam markers survive', async () => {
      const id = await createPlan('T');
      const first = await validate('T', planFields()).expect(201);
      const c1 = await as('post', '/study-plans/import/commit', 'T')
        .send({ staging_id: first.body.staging_id, plan_id: id })
        .expect(201);
      const again = await validate('T', planFields()).expect(201);
      const c2 = await as('post', '/study-plans/import/commit', 'T')
        .send({ staging_id: again.body.staging_id, plan_id: id })
        .expect(201);
      expect(c2.body.lessons.map((l: { id: string }) => l.id)).toEqual(
        c1.body.lessons.map((l: { id: string }) => l.id),
      );
    });

    it('a non-owner teacher can validate but is refused at commit (403)', async () => {
      const id = await createPlan('T');
      const v = await validate('U', planFields()).expect(201);
      await as('post', '/study-plans/import/commit', 'U')
        .send({ staging_id: v.body.staging_id, plan_id: id })
        .expect(403);
    });

    it('commits into a new plan for a section', async () => {
      const v = await validate('ADMIN', planFields()).expect(201);
      const c = await as('post', '/study-plans/import/commit', 'ADMIN')
        .send({
          staging_id: v.body.staging_id,
          plan: { section_id: SEED_SECTION_1_ID, subject_id: subjectId, academic_term_id: null },
        })
        .expect(201);
      expect(c.body.lessons).toHaveLength(2);
      expect(c.body.section.id).toBe(SEED_SECTION_1_ID);
    });

    it('row errors block the commit (409)', async () => {
      const id = await createPlan('T');
      const v = await validate('T', planFields(), csvText(['A,0,,'])).expect(201);
      expect(v.body.hard_error_count).toBe(1);
      await as('post', '/study-plans/import/commit', 'T')
        .send({ staging_id: v.body.staging_id, plan_id: id })
        .expect(409);
    });

    it('a staging id from user A cannot be committed by user B (404)', async () => {
      const id = await createPlan('T');
      const v = await validate('ADMIN', planFields()).expect(201);
      await as('post', '/study-plans/import/commit', 'T')
        .send({ staging_id: v.body.staging_id, plan_id: id })
        .expect(404);
    });

    it('PARENT and STUDENT cannot validate; EXECUTIVE cannot import into a plan', async () => {
      await validate('PARENT', planFields()).expect(403);
      await validate('STUDENT', planFields()).expect(403);
      await validate('EXECUTIVE', planFields()).expect(403);
    });

    it('sending neither pair, both pairs, or half a pair is 400', async () => {
      await validate('ADMIN', {}).expect(400);
      await validate('ADMIN', { ...planFields(), class_grade: '7', subject_code: 'MATH' }).expect(
        400,
      );
      await validate('ADMIN', { class_id: SEED_CLASS_1_ID }).expect(400);
    });

    it('a class staging id cannot be committed into a template (400)', async () => {
      const v = await validate('ADMIN', planFields()).expect(201);
      await as('post', '/study-plans/import/commit', 'ADMIN')
        .send({
          staging_id: v.body.staging_id,
          template: { name: 'X', class_grade: 7, subject_code: subjectCode },
        })
        .expect(400);
    });

    it('another tenant class id is 404', async () => {
      await validate('ADMIN2', planFields(), GOOD, TENANT_2).expect(404);
    });
  });

  // ------------------------------------------------- import: template target (D45)

  describe('import into the template library', () => {
    const tplFields = () => ({ class_grade: '7', subject_code: subjectCode });

    it('ADMIN and EXECUTIVE create a template; topic cells give warnings, no topics kept', async () => {
      for (const who of ['ADMIN', 'EXECUTIVE'] as const) {
        const v = await validate(who, tplFields()).expect(201);
        expect(v.body.warnings.length).toBeGreaterThan(0);
        expect(v.body.warnings[0].message).toBe('topics are not kept in templates');
        const c = await as('post', '/study-plans/import/commit', who)
          .send({
            staging_id: v.body.staging_id,
            template: { name: `CSV ${who}`, class_grade: 7, subject_code: subjectCode },
          })
          .expect(201);
        expect(c.body).toMatchObject({ class_grade: 7, subject_code: subjectCode });
        expect(c.body.lessons).toHaveLength(2);
      }
    });

    it('a teacher cannot import into the library (403 at validate)', async () => {
      await validate('T', tplFields()).expect(403);
    });

    it('a template staging id cannot be committed into a plan (400); EXECUTIVE is 403 there', async () => {
      const id = await createPlan();
      const a = await validate('ADMIN', tplFields()).expect(201);
      await as('post', '/study-plans/import/commit', 'ADMIN')
        .send({ staging_id: a.body.staging_id, plan_id: id })
        .expect(400);
      const e = await validate('EXECUTIVE', tplFields()).expect(201);
      await as('post', '/study-plans/import/commit', 'EXECUTIVE')
        .send({ staging_id: e.body.staging_id, plan_id: id })
        .expect(403);
    });

    it('a commit whose grade/code differs from the validated pair is 400', async () => {
      const v = await validate('ADMIN', tplFields()).expect(201);
      await as('post', '/study-plans/import/commit', 'ADMIN')
        .send({
          staging_id: v.body.staging_id,
          template: { name: 'X', class_grade: 8, subject_code: subjectCode },
        })
        .expect(400);
    });
  });

  // -------------------------------------------------------------- progress.csv

  describe('GET /study-plans/progress.csv', () => {
    const url = () =>
      `/study-plans/progress.csv?class_id=${SEED_CLASS_1_ID}&academic_term_id=${termId}`;

    it('ADMIN and EXECUTIVE get one row per plan of the class and term', async () => {
      await createPlan('ADMIN', termId);
      for (const who of ['ADMIN', 'EXECUTIVE'] as const) {
        const res = await as('get', url(), who).expect(200);
        expect(res.headers['content-type']).toContain('text/csv');
        expect(res.headers['content-disposition']).toContain('study-plan-progress-');
        const lines = res.text.replace(/^﻿/, '').split('\r\n');
        expect(lines[0]).toContain('"section","subject","owners"');
        expect(lines).toHaveLength(2);
        expect(lines[1]).toContain('SPCSV E2E Maths');
      }
    });

    it('teachers, parents and students get 403 (tenant-wide check); COMMITTEE too (no SYLLABUS_READ)', async () => {
      for (const who of ['T', 'U', 'PARENT', 'STUDENT', 'COMMITTEE'] as const) {
        await as('get', url(), who).expect(403);
      }
    });

    it('is not swallowed by /:id, and a missing class_id is a 400', async () => {
      await as('get', '/study-plans/progress.csv', 'ADMIN').expect(400);
    });

    it('another tenant never sees tenant-1 rows (header only) and a missing header is 401', async () => {
      await createPlan('ADMIN', termId);
      const res = await as('get', url(), 'ADMIN2', TENANT_2).expect(200);
      expect(res.text.replace(/^﻿/, '').split('\r\n')).toHaveLength(1);
      await as('get', url(), 'ADMIN2', SEED_TENANT_ID).expect(401);
    });
  });
});
