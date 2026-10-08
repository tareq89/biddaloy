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
  SEED_SECTION_1_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
} from '@test/constants';

/**
 * E2E for the study-plan template routes (66.2.06): the role matrix, the
 * copy owner scope, and the tenant fence. PARENT/STUDENT can read the
 * library today (they hold SYLLABUS_READ); that is pinned on purpose.
 */
const API = '/api/v1';
const TENANT_2 = '00000000-0000-4000-8000-0000007c0002';

const USERS = {
  T: { id: '00000000-0000-4000-8000-0000007c0001', role: UserRole.TEACHER },
  U: { id: '00000000-0000-4000-8000-0000007c0003', role: UserRole.TEACHER },
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

const NO_ACCESS = ['COMMITTEE', 'ACCOUNTANT', 'OFFICE_STAFF', 'EXAM_CONTROLLER'] as const;
const READ_ONLY = ['PARENT', 'STUDENT'] as const;

describe('Study plan templates E2E (66.2.06)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  const tokens: Record<string, string> = {};
  let adminToken: string;
  let subjectId: string;
  let subjectCode: string;

  const email = (who: string) => `spt-e2e-${who.toLowerCase()}@e2e.example`;

  async function login(mail: string): Promise<string> {
    const res = await supertest(app.getHttpServer())
      .post(`${API}/auth/login`)
      .send({ email: mail, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    return res.body.access_token;
  }

  function as(
    method: 'get' | 'post' | 'patch' | 'delete',
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
         VALUES (gen_random_uuid(), $2::uuid, $3::uuid, 'EMP-SPTE2E-' || $4, NOW(), NOW())
         ON CONFLICT (user_id) DO UPDATE SET updated_at = NOW()
         RETURNING id
       )
       INSERT INTO teachers (id, user_id, employee_id, designations, tenant_id, staff_profile_id, created_at, updated_at)
       SELECT $1::uuid, $2::uuid, 'SPTE2E-' || $4, '{}', $3::uuid, sp.id, NOW(), NOW() FROM sp`,
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
       VALUES ($1, 'Tenant Two', 'spt-e2e-tenant-two', NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [TENANT_2],
    );
    for (const [who, u] of Object.entries(USERS)) {
      const tenant = who === 'ADMIN2' ? TENANT_2 : SEED_TENANT_ID;
      await dataSource.query(
        `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'ACTIVE', NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [u.id, email(who), SEED_ADMIN_PASSWORD_HASH, `SPT E2E ${who}`],
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
    subjectCode = `SPT-${randomUUID().slice(0, 8)}`;
    subjectId = (
      await dataSource.query(
        `INSERT INTO subjects (id, tenant_id, name_en, code, created_at, updated_at)
         VALUES ($1, $2, 'SPT E2E Maths', $3, NOW(), NOW()) RETURNING id`,
        [randomUUID(), SEED_TENANT_ID, subjectCode],
      )
    )[0].id;
    await dataSource.query(
      `INSERT INTO class_subjects (id, tenant_id, class_id, subject_id, academic_year_id, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW(), NOW())`,
      [SEED_TENANT_ID, SEED_CLASS_1_ID, subjectId, SEED_ACADEMIC_YEAR_ID],
    );

    const teacherT = await makeTeacher(USERS.T.id, 'T');
    await makeTeacher(USERS.U.id, 'U');
    // Published routine slot: T teaches this subject in section 1 (T owns the plan).
    const [{ id: shiftId }] = await dataSource.query(
      `INSERT INTO shifts (id, tenant_id, name, day_starts_at, day_ends_at, sequence, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, '08:00', '13:00', 0, NOW(), NOW()) RETURNING id`,
      [SEED_TENANT_ID, `SPT E2E ${randomUUID().slice(0, 8)}`],
    );
    const [{ id: periodId }] = await dataSource.query(
      `INSERT INTO period_slots (id, tenant_id, shift_id, sequence, kind, name, starts_at, ends_at, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, 1, 'CLASS', 'P1', '08:00', '08:45', NOW(), NOW()) RETURNING id`,
      [SEED_TENANT_ID, shiftId],
    );
    const [{ id: routineId }] = await dataSource.query(
      `INSERT INTO routines (id, tenant_id, academic_year_id, name, state, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, 'SPT E2E', 'PUBLISHED', NOW(), NOW()) RETURNING id`,
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

  const body = (over: Record<string, unknown> = {}) => ({
    name: `Tpl ${randomUUID().slice(0, 8)}`,
    class_grade: 7,
    subject_code: subjectCode,
    lessons: [
      { title: 'One', periods: 2 },
      { title: 'Two', periods: 3 },
    ],
    ...over,
  });
  const copyBody = () => ({
    section_id: SEED_SECTION_1_ID,
    subject_id: subjectId,
    academic_term_id: null,
  });

  async function createTemplate(): Promise<string> {
    const res = await as('post', '/study-plan-templates', 'ADMIN').send(body()).expect(201);
    return res.body.id;
  }

  describe('reads', () => {
    for (const who of ['ADMIN', 'EXECUTIVE', 'T', 'U', ...READ_ONLY] as const) {
      it(`${who} gets 200 on list and detail`, async () => {
        const id = await createTemplate();
        const list = await as(
          'get',
          `/study-plan-templates?subject_code=${subjectCode}`,
          who,
        ).expect(200);
        expect(list.body.data.map((d: { id: string }) => d.id)).toContain(id);
        const one = await as('get', `/study-plan-templates/${id}`, who).expect(200);
        expect(one.body.lessons).toHaveLength(2);
      });
    }

    for (const who of NO_ACCESS) {
      it(`${who} gets 403 on list and detail`, async () => {
        const id = await createTemplate();
        await as('get', '/study-plan-templates', who).expect(403);
        await as('get', `/study-plan-templates/${id}`, who).expect(403);
      });
    }

    it('list summary has the documented fields', async () => {
      await createTemplate();
      const res = await as(
        'get',
        `/study-plan-templates?class_grade=7&subject_code=${subjectCode}`,
        'ADMIN',
      ).expect(200);
      expect(res.body.data[0]).toMatchObject({
        class_grade: 7,
        subject_code: subjectCode,
        subject_name: 'SPT E2E Maths',
        lesson_count: 2,
        total_periods: 5,
      });
    });
  });

  describe('writes (STUDY_PLAN_TEMPLATE_MANAGE)', () => {
    it('ADMIN and EXECUTIVE can create, patch and delete', async () => {
      for (const who of ['ADMIN', 'EXECUTIVE'] as const) {
        const created = await as('post', '/study-plan-templates', who).send(body()).expect(201);
        await as('patch', `/study-plan-templates/${created.body.id}`, who)
          .send({ name: `Renamed ${who}` })
          .expect(200);
        await as('delete', `/study-plan-templates/${created.body.id}`, who).expect(204);
      }
    });

    it('a duplicate name is 409 STUDY_PLAN_TEMPLATE_NAME_TAKEN', async () => {
      const b = body({ name: 'Dup name' });
      await as('post', '/study-plan-templates', 'ADMIN').send(b).expect(201);
      const res = await as('post', '/study-plan-templates', 'ADMIN').send(b).expect(409);
      expect(res.body.details.code).toBe('STUDY_PLAN_TEMPLATE_NAME_TAKEN');
    });

    it('bad bodies are 400, including a lesson topic_id and a grade outside 1-12', async () => {
      const post = (b: object) => as('post', '/study-plan-templates', 'ADMIN').send(b);
      await post(body({ class_grade: 13 })).expect(400);
      await post(body({ class_grade: 0 })).expect(400);
      await post(body({ lessons: [{ title: 'L', periods: 1, topic_id: randomUUID() }] })).expect(
        400,
      );
    });

    for (const who of ['T', 'U', ...READ_ONLY, ...NO_ACCESS] as const) {
      it(`${who} gets 403 on every write route`, async () => {
        const id = await createTemplate();
        await as('post', '/study-plan-templates', who).send(body()).expect(403);
        await as('patch', `/study-plan-templates/${id}`, who).send({ name: 'x' }).expect(403);
        await as('delete', `/study-plan-templates/${id}`, who).expect(403);
        await as('post', `/study-plan-templates/from-plan/${randomUUID()}`, who)
          .send({})
          .expect(403);
      });
    }
  });

  describe('from-plan', () => {
    it('ADMIN saves a plan as a template', async () => {
      await dataSource.query('UPDATE classes SET numeric_grade = 7 WHERE id = $1', [
        SEED_CLASS_1_ID,
      ]);
      const plan = await as('post', '/study-plans', 'ADMIN')
        .send({ ...copyBody(), lessons: [{ title: 'P1', periods: 2 }] })
        .expect(201);
      const res = await as('post', `/study-plan-templates/from-plan/${plan.body.id}`, 'ADMIN')
        .send({ name: 'From plan' })
        .expect(201);
      expect(res.body).toMatchObject({
        name: 'From plan',
        class_grade: 7,
        subject_code: subjectCode,
        lesson_count: 1,
      });
    });
  });

  describe('POST :id/copy', () => {
    it('ADMIN and the owner T get 201 with new lesson ids and no topic', async () => {
      const id = await createTemplate();
      const tplLessons = (await as('get', `/study-plan-templates/${id}`, 'ADMIN')).body.lessons;
      const res = await as('post', `/study-plan-templates/${id}/copy`, 'T')
        .send(copyBody())
        .expect(201);
      expect(res.body.lessons).toHaveLength(2);
      for (const l of res.body.lessons) {
        expect(tplLessons.map((t: { id: string }) => t.id)).not.toContain(l.id);
        expect(l.topic_id).toBeUndefined();
      }
      // Second copy into the same scope is 409 (also proves ADMIN reaches the service).
      await as('post', `/study-plan-templates/${id}/copy`, 'ADMIN').send(copyBody()).expect(409);
    });

    it('ADMIN gets 201', async () => {
      const id = await createTemplate();
      await as('post', `/study-plan-templates/${id}/copy`, 'ADMIN').send(copyBody()).expect(201);
    });

    for (const who of ['EXECUTIVE', 'U', ...READ_ONLY, ...NO_ACCESS] as const) {
      it(`${who} gets 403`, async () => {
        const id = await createTemplate();
        await as('post', `/study-plan-templates/${id}/copy`, who).send(copyBody()).expect(403);
      });
    }
  });

  describe('tenant fence', () => {
    it('tenant-2 ADMIN gets 404 on read / patch / delete / copy, and the template is unchanged', async () => {
      const id = await createTemplate();
      const p = `/study-plan-templates/${id}`;
      await as('get', p, 'ADMIN2', TENANT_2).expect(404);
      await as('patch', p, 'ADMIN2', TENANT_2).send({ name: 'hijack' }).expect(404);
      await as('delete', p, 'ADMIN2', TENANT_2).expect(404);
      await as('post', `${p}/copy`, 'ADMIN2', TENANT_2).send(copyBody()).expect(404);

      const still = await as('get', p, 'ADMIN').expect(200);
      expect(still.body.name).not.toBe('hijack');
      const list = await as('get', '/study-plan-templates', 'ADMIN2', TENANT_2).expect(200);
      expect(list.body.data).toEqual([]);
    });

    it('a request without X-Tenant-ID is 401', async () => {
      await supertest(app.getHttpServer())
        .get(`${API}/study-plan-templates`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(401);
    });
  });
});
