import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import supertest = require('supertest');
import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { TeacherAssignmentType, UserRole } from '@biddaloy/shared';
import { Teacher } from '../academics/entities/teacher.entity';
import {
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
  SEED_ADMIN_USER_ID,
  SEED_SECTION_1_ID,
  SEED_SECTION_2_ID,
  SEED_TENANT_ID,
} from '@test/constants';

/**
 * [52.2.1] D50: guardians and students never see the staff list. `GET tag-options` and
 * `POST :id/tags` are employee-only, and a guardian's submit with `tags` is a 400.
 */
describe('Applications E2E (D50)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  const API = '/api/v1/applications';

  const parentId = randomUUID();
  const studentUserId = randomUUID();
  const parentEmail = `app-e2e-parent-${parentId}@test.com`;
  const studentEmail = `app-e2e-student-${studentUserId}@test.com`;
  const parent2Id = randomUUID();
  const ctUserId = randomUUID();
  const otherTeacherId = randomUUID();
  const officeId = randomUUID();
  const accountantId = randomUUID();
  const TENANT_B = randomUUID();
  const emailOf = (id: string) => `app-e2e-${id}@test.com`;
  const tokens: Record<string, string> = {};
  let otherChildId: string;
  let parentToken: string;
  let studentToken: string;
  let adminToken: string;
  let childId: string;

  async function login(email: string): Promise<string> {
    const res = await supertest(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    return res.body.access_token;
  }
  const call = (method: 'get' | 'post', path: string, token: string) =>
    supertest(app.getHttpServer())
      [method](path)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', SEED_TENANT_ID);

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    dataSource = app.get(DataSource);

    // Users and memberships survive the per-test reset, so create them once.
    for (const [id, email, name, role] of [
      [parentId, parentEmail, 'E2E Parent', UserRole.PARENT],
      [studentUserId, studentEmail, 'E2E Student', UserRole.STUDENT],
      [parent2Id, emailOf(parent2Id), 'E2E Parent Two', UserRole.PARENT],
      [ctUserId, emailOf(ctUserId), 'E2E Class Teacher', UserRole.TEACHER],
      [otherTeacherId, emailOf(otherTeacherId), 'E2E Other Teacher', UserRole.TEACHER],
      [officeId, emailOf(officeId), 'E2E Office', UserRole.OFFICE_STAFF],
      [accountantId, emailOf(accountantId), 'E2E Accountant', UserRole.ACCOUNTANT],
    ] as const) {
      await dataSource.query(
        `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'ACTIVE', NOW(), NOW())`,
        [id, email, SEED_ADMIN_PASSWORD_HASH, name],
      );
      await dataSource.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW())`,
        [id, SEED_TENANT_ID, role],
      );
    }
    parentToken = await login(parentEmail);
    studentToken = await login(studentEmail);
    for (const id of [parent2Id, ctUserId, otherTeacherId, officeId, accountantId]) {
      tokens[id] = await login(emailOf(id));
    }

    // Tenant B, where the seed admin is also an ADMIN (X-Tenant-ID picks the tenant).
    await dataSource.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, 'Applications E2E Tenant B', $2, NOW(), NOW())`,
      [TENANT_B, `applications-e2e-b-${TENANT_B.slice(0, 8)}`],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, 'ADMIN', NOW(), NOW())`,
      [SEED_ADMIN_USER_ID, TENANT_B],
    );
    // Logged in after the B membership exists, so the token knows both tenants.
    adminToken = await login(SEED_ADMIN_EMAIL);
  }, 90000);

  afterAll(async () => {
    // Test users stay (applications reference them); the test database is dropped after the run.
    await dataSource.query(`DELETE FROM user_tenants WHERE tenant_id = $1`, [TENANT_B]);
    await dataSource.query(`DELETE FROM schools WHERE id = $1`, [TENANT_B]);
    await app.close();
  });

  beforeEach(async () => {
    // Students and guardians are cleared before every test.
    const [student] = await dataSource.query(
      `INSERT INTO students (full_name, registration_number, roll_number, class_section_id, tenant_id,
                             user_id, enrollment_status, preferred_communication, created_at, updated_at)
       VALUES ('E2E Child', $1, 1, $2, $3, $4, 'ACTIVE', 'SMS', NOW(), NOW()) RETURNING id`,
      [`E2E-${randomUUID().slice(0, 10)}`, SEED_SECTION_1_ID, SEED_TENANT_ID, studentUserId],
    );
    childId = student.id;
    const [guardian] = await dataSource.query(
      `INSERT INTO guardians (full_name, relationship, phone, email, tenant_id, user_id,
                              preferred_communication, is_primary_contact, created_at, updated_at)
       VALUES ('E2E Guardian', 'FATHER', '+8801700000001', $1, $2, $3, 'SMS', true, NOW(), NOW()) RETURNING id`,
      [`g-${randomUUID()}@test.com`, SEED_TENANT_ID, parentId],
    );
    await dataSource.query(
      `INSERT INTO student_guardians (student_id, guardian_id) VALUES ($1, $2)`,
      [childId, guardian.id],
    );

    // Matrix fixtures: a second child (other section) whose parent is not linked to childId.
    const [other] = await dataSource.query(
      `INSERT INTO students (full_name, registration_number, roll_number, class_section_id, tenant_id,
                             enrollment_status, preferred_communication, created_at, updated_at)
       VALUES ('E2E Other Child', $1, 2, $2, $3, 'ACTIVE', 'SMS', NOW(), NOW()) RETURNING id`,
      [`E2E-${randomUUID().slice(0, 10)}`, SEED_SECTION_2_ID, SEED_TENANT_ID],
    );
    otherChildId = other.id;
    const [guardian2] = await dataSource.query(
      `INSERT INTO guardians (full_name, relationship, phone, email, tenant_id, user_id,
                              preferred_communication, is_primary_contact, created_at, updated_at)
       VALUES ('E2E Guardian Two', 'MOTHER', '+8801700000002', $1, $2, $3, 'SMS', true, NOW(), NOW()) RETURNING id`,
      [`g2-${randomUUID()}@test.com`, SEED_TENANT_ID, parent2Id],
    );
    await dataSource.query(
      `INSERT INTO student_guardians (student_id, guardian_id) VALUES ($1, $2)`,
      [otherChildId, guardian2.id],
    );

    // Teachers are cleared per test too. Saving a Teacher also creates its staff profile.
    const teacherRepo = dataSource.getRepository(Teacher);
    const classTeacher = await teacherRepo.save({
      user_id: ctUserId,
      tenant_id: SEED_TENANT_ID,
      employee_id: `AE-${randomUUID().slice(0, 12)}`,
      designations: [],
    });
    await teacherRepo.save({
      user_id: otherTeacherId,
      tenant_id: SEED_TENANT_ID,
      employee_id: `AE-${randomUUID().slice(0, 12)}`,
      designations: [],
    });
    await dataSource.query(
      `INSERT INTO teacher_class_sections (teacher_id, section_id, tenant_id, assignment_type, created_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [classTeacher.id, SEED_SECTION_1_ID, SEED_TENANT_ID, TeacherAssignmentType.CLASS_TEACHER],
    );
  });

  it('PARENT and STUDENT get 403 on GET /applications/tag-options; staff get 200', async () => {
    await call('get', `${API}/tag-options?q=a`, parentToken).expect(403);
    await call('get', `${API}/tag-options?q=a`, studentToken).expect(403);
    const res = await call('get', `${API}/tag-options?q=a`, adminToken).expect(200);
    expect(res.body.roles).toContain('TEACHER');
  });

  it('PARENT and STUDENT get 403 on POST /applications/:id/tags', async () => {
    const body = { tags: [{ role: 'OFFICE_STAFF' }] };
    await call('post', `${API}/${randomUUID()}/tags`, parentToken).send(body).expect(403);
    await call('post', `${API}/${randomUUID()}/tags`, studentToken).send(body).expect(403);
  });

  it('a PARENT submit with tags is a 400 APPLICATION_TAGS_STAFF_ONLY; without tags it is a 201', async () => {
    const payload = {
      reason_kind: 'SICK',
      start_date: '2026-10-12',
      end_date: '2026-10-14',
      details: 'Fever, doctor advised rest',
    };
    const withTags = await call('post', API, parentToken)
      .send({
        type: 'STUDENT_LEAVE',
        subject_student_id: childId,
        payload,
        tags: [{ role: 'OFFICE_STAFF' }],
      })
      .expect(400);
    expect(withTags.body.details?.code ?? withTags.body.error?.details?.code).toBe(
      'APPLICATION_TAGS_STAFF_ONLY',
    );

    const created = await call('post', API, parentToken)
      .send({ type: 'STUDENT_LEAVE', subject_student_id: childId, payload })
      .expect(201);
    expect(created.body).toMatchObject({ status: 'PENDING', can: { withdraw: true } });
    expect(created.body.serial).toMatch(/^\d{4}\/0001$/);

    // And the new application is readable through GET /:id by its applicant.
    await call('get', `${API}/${created.body.id}`, parentToken).expect(200);
  });

  // [52.2.7] Role matrix: who may submit, list and read (D8, D14, D22, D29, D43, D46).
  describe('role matrix', () => {
    const leave = {
      reason_kind: 'SICK',
      start_date: '2026-10-12',
      end_date: '2026-10-14',
      details: 'Fever, doctor advised rest',
    };
    const asTenant = (path: string, token: string, tenant: string) =>
      supertest(app.getHttpServer())
        .get(path)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', tenant);
    const submitBody = () => ({
      type: 'STUDENT_LEAVE',
      subject_student_id: childId,
      payload: leave,
    });
    const onBehalfBody = () => ({ ...submitBody(), on_behalf_of_user_id: parentId });
    let applicationId: string;
    const inboxHas = async (token: string, id: string) => {
      const res = await call('get', `${API}?view=inbox&limit=100`, token).expect(200);
      return (res.body.data as { id: string }[]).some((r) => r.id === id);
    };

    beforeEach(async () => {
      const res = await call('post', API, parentToken).send(submitBody()).expect(201);
      applicationId = res.body.id;
    });

    /** One matrix row: the five columns for a single caller. */
    async function checkRow(
      token: string,
      expected: { own: number; onBehalf: number; inbox: boolean; all: number; get: number },
    ) {
      await call('post', API, token).send(submitBody()).expect(expected.own);
      const behalf = await call('post', API, token).send(onBehalfBody());
      expect(behalf.status).toBe(expected.onBehalf);
      if (expected.onBehalf === 201) expect(behalf.body.source).toBe('PAPER');
      expect(await inboxHas(token, applicationId)).toBe(expected.inbox);
      await call('get', `${API}?view=all`, token).expect(expected.all);
      await call('get', `${API}/${applicationId}`, token).expect(expected.get);
    }

    it('linked PARENT', async () => {
      await checkRow(parentToken, { own: 201, onBehalf: 403, inbox: false, all: 403, get: 200 });
    });

    it('the STUDENT', async () => {
      await checkRow(studentToken, { own: 201, onBehalf: 403, inbox: false, all: 403, get: 200 });
    });

    it('unlinked PARENT (other child)', async () => {
      await checkRow(tokens[parent2Id], {
        own: 403,
        onBehalf: 403,
        inbox: false,
        all: 403,
        get: 404,
      });
    });

    it('class teacher sees it in the inbox', async () => {
      await checkRow(tokens[ctUserId], {
        own: 403,
        onBehalf: 403,
        inbox: true,
        all: 403,
        get: 200,
      });
    });

    it('other TEACHER', async () => {
      await checkRow(tokens[otherTeacherId], {
        own: 403,
        onBehalf: 403,
        inbox: false,
        all: 403,
        get: 404,
      });
    });

    it('OFFICE_STAFF enters a PAPER application and sees view=all', async () => {
      await checkRow(tokens[officeId], {
        own: 403,
        onBehalf: 201,
        inbox: false,
        all: 200,
        get: 200,
      });
    });

    it('ADMIN: not the first step, but may enter on behalf and see everything', async () => {
      await checkRow(adminToken, { own: 403, onBehalf: 201, inbox: false, all: 200, get: 200 });
    });

    it('ACCOUNTANT', async () => {
      await checkRow(tokens[accountantId], {
        own: 403,
        onBehalf: 403,
        inbox: false,
        all: 403,
        get: 404,
      });
    });

    it('ADMIN of tenant B sees an empty list and a 404 on tenant A ids', async () => {
      const list = await asTenant(`${API}?view=all`, adminToken, TENANT_B).expect(200);
      expect(list.body.data).toEqual([]);
      await asTenant(`${API}/${applicationId}`, adminToken, TENANT_B).expect(404);
    });

    it('a TEACHER files STAFF_LEAVE for themself; the ADMIN inbox contains it', async () => {
      const res = await call('post', API, tokens[otherTeacherId])
        .send({
          type: 'STAFF_LEAVE',
          payload: {
            leave_type: 'CASUAL',
            start_date: '2026-10-12',
            end_date: '2026-10-13',
            reason: 'Family event',
          },
        })
        .expect(201);
      expect(await inboxHas(adminToken, res.body.id)).toBe(true);
    });

    it('view=mine returns the paged shape', async () => {
      const res = await call('get', `${API}?view=mine`, parentToken).expect(200);
      expect(Object.keys(res.body).sort()).toEqual([
        'data',
        'limit',
        'page',
        'total',
        'totalPages',
      ]);
    });

    it('letter-preview as the linked PARENT renders a letter and writes no row', async () => {
      const count = async () =>
        (await dataSource.query(`SELECT COUNT(*)::int AS n FROM applications`))[0].n as number;
      const before = await count();
      const res = await call('post', `${API}/letter-preview`, parentToken)
        .send(submitBody())
        .expect(200);
      expect(res.body.letter_text).toEqual(expect.any(String));
      expect(res.body.letter_locale).toEqual(expect.any(String));
      expect(await count()).toBe(before);
    });

    it('unauthenticated GET /applications is a 401', async () => {
      await supertest(app.getHttpServer()).get(API).set('X-Tenant-ID', SEED_TENANT_ID).expect(401);
    });
  });
});
