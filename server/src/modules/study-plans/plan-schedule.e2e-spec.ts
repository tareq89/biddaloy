import { randomUUID } from 'crypto';
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
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

/** [66.2.02/#2007] E2E for the schedule, carry-over, capacity and list-summary routes. */
const API = '/api/v1';
const TENANT_2 = '00000000-0000-4000-8000-0000007c0002';

const USERS = {
  T: { id: '00000000-0000-4000-8000-0000007c0001', role: UserRole.TEACHER },
  U: { id: '00000000-0000-4000-8000-0000007c0003', role: UserRole.TEACHER },
  H: { id: '00000000-0000-4000-8000-0000007c0004', role: UserRole.TEACHER },
  EXECUTIVE: { id: '00000000-0000-4000-8000-0000007c0005', role: UserRole.EXECUTIVE },
  ACCOUNTANT: { id: '00000000-0000-4000-8000-0000007c0006', role: UserRole.ACCOUNTANT },
  OFFICE_STAFF: { id: '00000000-0000-4000-8000-0000007c0007', role: UserRole.OFFICE_STAFF },
  EXAM_CONTROLLER: { id: '00000000-0000-4000-8000-0000007c0008', role: UserRole.EXAM_CONTROLLER },
  COMMITTEE: { id: '00000000-0000-4000-8000-0000007c0009', role: UserRole.COMMITTEE },
  PARENT: { id: '00000000-0000-4000-8000-0000007c000a', role: UserRole.PARENT },
  STUDENT: { id: '00000000-0000-4000-8000-0000007c000b', role: UserRole.STUDENT },
  ADMIN2: { id: '00000000-0000-4000-8000-0000007c000c', role: UserRole.ADMIN },
} as const;
type Who = keyof typeof USERS;

describe('Plan schedule E2E (66.2.02)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  const tokens: Record<string, string> = {};
  let adminToken: string;
  let subjectId: string;
  let teacherT: string;
  let teacherU: string;

  const email = (who: string) => `sps-e2e-${who.toLowerCase()}@e2e.example`;

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
         VALUES (gen_random_uuid(), $2::uuid, $3::uuid, 'EMP-SPSE2E-' || $4, NOW(), NOW())
         ON CONFLICT (user_id) DO UPDATE SET updated_at = NOW()
         RETURNING id
       )
       INSERT INTO teachers (id, user_id, employee_id, designations, tenant_id, staff_profile_id, created_at, updated_at)
       SELECT $1::uuid, $2::uuid, 'SPSE2E-' || $4, '{}', $3::uuid, sp.id, NOW(), NOW() FROM sp`,
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
       VALUES ($1, 'Tenant Two', 'sps-e2e-tenant-two', NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [TENANT_2],
    );
    for (const [who, u] of Object.entries(USERS)) {
      const tenant = who === 'ADMIN2' ? TENANT_2 : SEED_TENANT_ID;
      await dataSource.query(
        `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'ACTIVE', NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [u.id, email(who), SEED_ADMIN_PASSWORD_HASH, `SPS E2E ${who}`],
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
         VALUES ($1, $2, 'SPS E2E Maths', $3, NOW(), NOW()) RETURNING id`,
        [randomUUID(), SEED_TENANT_ID, `SPS-${randomUUID().slice(0, 8)}`],
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
      [SEED_TENANT_ID, `SPS E2E ${randomUUID().slice(0, 8)}`],
    );
    const [{ id: periodId }] = await dataSource.query(
      `INSERT INTO period_slots (id, tenant_id, shift_id, sequence, kind, name, starts_at, ends_at, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, 1, 'CLASS', 'P1', '08:00', '08:45', NOW(), NOW()) RETURNING id`,
      [SEED_TENANT_ID, shiftId],
    );
    const [{ id: routineId }] = await dataSource.query(
      `INSERT INTO routines (id, tenant_id, academic_year_id, name, state, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, 'SPS E2E', 'PUBLISHED', NOW(), NOW()) RETURNING id`,
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

  // Year start is moved back so a 2020 term sits inside it (a past term: every Monday is owed).
  let yearStart: string;
  let termA: string;
  let termB: string;

  beforeEach(async () => {
    const [y] = await dataSource.query('SELECT start_date FROM academic_years WHERE id = $1', [
      SEED_ACADEMIC_YEAR_ID,
    ]);
    yearStart =
      typeof y.start_date === 'string' ? y.start_date : y.start_date.toISOString().slice(0, 10);
    await dataSource.query('UPDATE academic_years SET start_date = $2 WHERE id = $1', [
      SEED_ACADEMIC_YEAR_ID,
      '2020-01-01',
    ]);
    const mkTerm = async (seq: number, name: string, from: string, to: string) =>
      (
        await dataSource.query(
          `INSERT INTO academic_terms (id, tenant_id, academic_year_id, seq, name, start_date, end_date, created_at, updated_at)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, NOW(), NOW()) RETURNING id`,
          [
            SEED_TENANT_ID,
            SEED_ACADEMIC_YEAR_ID,
            seq,
            `${name} ${randomUUID().slice(0, 4)}`,
            from,
            to,
          ],
        )
      )[0].id as string;
    termA = await mkTerm(901, 'SPS A', '2020-01-06', '2020-12-31'); // 2020-01-06 is a Monday
    termB = await mkTerm(902, 'SPS B', '2020-01-01', '2020-01-02'); // Wed-Thu: no Monday
  });

  afterEach(async () => {
    await dataSource.query('UPDATE academic_years SET start_date = $2 WHERE id = $1', [
      SEED_ACADEMIC_YEAR_ID,
      yearStart,
    ]);
  });

  async function createPlan(term: string, lessons: unknown[] = []): Promise<string> {
    const res = await as('post', '/study-plans', 'ADMIN')
      .send({
        section_id: SEED_SECTION_1_ID,
        subject_id: subjectId,
        academic_term_id: term,
        lessons,
      })
      .expect(201);
    // Plans owe nothing before their creation day; date this one back so past periods count.
    await dataSource.query(`UPDATE study_plans SET created_at = '2000-01-01' WHERE id = $1`, [
      res.body.id,
    ]);
    return res.body.id;
  }

  describe('GET /study-plans/:id/schedule', () => {
    it('owner T, ADMIN, EXECUTIVE and the homeroom teacher H get 200', async () => {
      const id = await createPlan(termA, [{ title: 'L1', periods: 1 }]);
      for (const who of ['T', 'ADMIN', 'EXECUTIVE', 'H'] as const) {
        const res = await as('get', `/study-plans/${id}/schedule`, who).expect(200);
        expect(res.body.summary.lessons_total).toBe(1);
        expect(res.body.range).toEqual({ from: '2020-01-06', to: '2020-12-31' });
      }
    });

    it('unrelated teacher U, PARENT, STUDENT and COMMITTEE get 403', async () => {
      const id = await createPlan(termA);
      for (const who of ['U', 'PARENT', 'STUDENT', 'COMMITTEE'] as const) {
        await as('get', `/study-plans/${id}/schedule`, who).expect(403);
      }
    });
  });

  describe('GET /study-plans/:id/carry-over', () => {
    it('returns the unfinished lessons with new ids and the term', async () => {
      const id = await createPlan(termA, [
        { title: 'One', periods: 1 },
        { title: 'Two', periods: 2 },
      ]);
      const own = await as('get', `/study-plans/${id}`, 'ADMIN').expect(200);
      const res = await as('get', `/study-plans/${id}/carry-over`, 'ADMIN').expect(200);
      expect(res.body.lessons.map((l: { title: string }) => l.title)).toEqual(['One', 'Two']);
      const oldIds = own.body.lessons.map((l: { id: string }) => l.id);
      for (const l of res.body.lessons) expect(oldIds).not.toContain(l.id);
      expect(res.body.from_term.id).toBe(termA);
    });
  });

  describe('GET /study-plans summary, behind filter and sort', () => {
    it('behind=true keeps only behind plans, most behind first; rows carry the summary', async () => {
      const a = await createPlan(termA);
      await createPlan(termB);
      const res = await as(
        'get',
        '/study-plans?behind=true&sort=behind_periods&order=desc',
        'ADMIN',
      ).expect(200);
      expect(res.body.data.map((r: { id: string }) => r.id)).toEqual([a]);
      expect(res.body.data[0].summary.periods_behind).toBeGreaterThan(0);
      expect(res.body.data[0].summary).toHaveProperty('last_reported_at', null);
      const all = await as('get', '/study-plans?sort=behind_periods&order=desc', 'ADMIN').expect(
        200,
      );
      expect(all.body.total).toBe(2);
      expect(all.body.data[0].id).toBe(a);
      expect(all.body.data[1].summary.periods_behind).toBe(0);
    });

    it('a bad sort is 400', async () => {
      await as('get', '/study-plans?sort=nope', 'ADMIN').expect(400);
    });
  });

  describe('GET /study-plans/capacity', () => {
    const q = (term: string) =>
      `/study-plans/capacity?section_id=${SEED_SECTION_1_ID}&subject_id=${subjectId}&academic_term_id=${term}`;

    it('200 with periods_left for the writer scope; not swallowed by /:id', async () => {
      const res = await as('get', q(termA), 'ADMIN').expect(200);
      expect(res.body.periods_left).toBe(0); // the term is entirely in the past
      expect(res.body.periods_total).toBeGreaterThan(0);
      await as('get', q(termA), 'T').expect(200);
    });

    it('a teacher who does not own the scope gets 403', async () => {
      await as('get', q(termA), 'U').expect(403);
    });
  });

  describe('tenant isolation', () => {
    it('a tenant-2 ADMIN gets 404 on a tenant-1 plan schedule; a missing X-Tenant-ID is 401', async () => {
      const id = await createPlan(termA);
      await as('get', `/study-plans/${id}/schedule`, 'ADMIN2', TENANT_2).expect(404);
      await supertest(app.getHttpServer())
        .get(`${API}/study-plans/${id}/schedule`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(401);
    });
  });
});
