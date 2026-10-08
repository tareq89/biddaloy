import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { UserRole } from '@biddaloy/shared';
import {
  SEED_TENANT_ID,
  SEED_CLASS_1_ID,
  SEED_CLASS_2_ID,
  SEED_SECTION_1_ID,
  SEED_ADMIN_USER_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD,
} from '@test/constants';

/**
 * E2E tests for `/syllabus-topics` (#967/22.3.4): `SYLLABUS_READ`/
 * `SYLLABUS_MANAGE` gating — STUDENT/PARENT can read, cannot write.
 * Create/reorder/edit/delete business logic is covered by
 * `syllabus.service.spec.ts`.
 */
const API = '/api/v1';

describe('Syllabus Topics E2E (22.3.4)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let adminToken: string;
  let subjectId: string;

  async function login(email: string): Promise<string> {
    const res = await supertest(app.getHttpServer())
      .post(`${API}/auth/login`)
      .send({ email, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    return res.body.access_token;
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
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       SELECT id, $1, $2, NOW(), NOW() FROM users WHERE email = $3
       ON CONFLICT DO NOTHING`,
      [SEED_TENANT_ID, UserRole.STUDENT, SEED_ADMIN_EMAIL],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       SELECT id, $1, $2, NOW(), NOW() FROM users WHERE email = $3
       ON CONFLICT DO NOTHING`,
      [SEED_TENANT_ID, UserRole.PARENT, SEED_ADMIN_EMAIL],
    );

    // One user holds every role we exercise; the `X-Role` header picks one.
    for (const role of [
      UserRole.TEACHER,
      UserRole.EXECUTIVE,
      UserRole.ACCOUNTANT,
      UserRole.OFFICE_STAFF,
      UserRole.EXAM_CONTROLLER,
      UserRole.COMMITTEE,
    ]) {
      await dataSource.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [SEED_ADMIN_USER_ID, SEED_TENANT_ID, role],
      );
    }

    adminToken = await login(SEED_ADMIN_EMAIL);
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  // `subjects` is a transactional table (`test/reset-order.ts`) truncated
  // by the global `beforeEach` before every test, unlike the `classes`
  // reference row seeded once in `beforeAll` above — so the fixture
  // subject has to be re-inserted on the same cadence.
  beforeEach(async () => {
    const subject = await dataSource.query(
      `INSERT INTO subjects (id, tenant_id, name_en, code, created_at, updated_at)
       VALUES (DEFAULT, $1, 'Syllabus E2E Subject', 'SYLE2E', NOW(), NOW())
       RETURNING id`,
      [SEED_TENANT_ID],
    );
    subjectId = subject[0].id;
  });

  it('an ADMIN creates a topic and reads it back', async () => {
    const createRes = await supertest(app.getHttpServer())
      .post(`${API}/syllabus-topics`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .send({
        class_id: SEED_CLASS_1_ID,
        subject_id: subjectId,
        name: 'E2E Topic 1',
        sequence: 1,
      })
      .expect(201);

    expect(createRes.body.status).toBe('PLANNED');

    const listRes = await supertest(app.getHttpServer())
      .get(`${API}/syllabus-topics`)
      .query({ class_id: SEED_CLASS_1_ID, subject_id: subjectId })
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .expect(200);

    expect(listRes.body.some((t: { id: string }) => t.id === createRes.body.id)).toBe(true);
  });

  it('a STUDENT can read syllabus topics but cannot create one (403, PermissionsGuard)', async () => {
    const studentToken = await supertest(app.getHttpServer())
      .post(`${API}/auth/login`)
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200)
      .then((res) => res.body.access_token);

    await supertest(app.getHttpServer())
      .get(`${API}/syllabus-topics`)
      .query({ class_id: SEED_CLASS_1_ID, subject_id: subjectId })
      .set('Authorization', `Bearer ${studentToken}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .set('X-Role', UserRole.STUDENT)
      .expect(200);

    await supertest(app.getHttpServer())
      .post(`${API}/syllabus-topics`)
      .set('Authorization', `Bearer ${studentToken}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .set('X-Role', UserRole.STUDENT)
      .send({
        class_id: SEED_CLASS_1_ID,
        subject_id: subjectId,
        name: 'Student Attempt',
        sequence: 2,
      })
      .expect(403);
  });

  it('a PARENT can read syllabus topics but cannot delete one (403, PermissionsGuard)', async () => {
    const parentToken = await supertest(app.getHttpServer())
      .post(`${API}/auth/login`)
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200)
      .then((res) => res.body.access_token);

    const createRes = await supertest(app.getHttpServer())
      .post(`${API}/syllabus-topics`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .send({
        class_id: SEED_CLASS_1_ID,
        subject_id: subjectId,
        name: 'Parent Read Target',
        sequence: 3,
      })
      .expect(201);

    const parentList = await supertest(app.getHttpServer())
      .get(`${API}/syllabus-topics`)
      .query({ class_id: SEED_CLASS_1_ID, subject_id: subjectId })
      .set('Authorization', `Bearer ${parentToken}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .set('X-Role', UserRole.PARENT)
      .expect(200);

    // [31.3.7c] families get 403 on /subjects, so the topic carries the name.
    const readBack = parentList.body.find((t: { id: string }) => t.id === createRes.body.id);
    expect(readBack.subject_name_en).toBe('Syllabus E2E Subject');

    await supertest(app.getHttpServer())
      .delete(`${API}/syllabus-topics/${createRes.body.id}`)
      .set('Authorization', `Bearer ${parentToken}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .set('X-Role', UserRole.PARENT)
      .expect(403);
  });

  it('bulk-reorders topics', async () => {
    const a = await supertest(app.getHttpServer())
      .post(`${API}/syllabus-topics`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .send({ class_id: SEED_CLASS_1_ID, subject_id: subjectId, name: 'Reorder A', sequence: 10 })
      .expect(201);
    const b = await supertest(app.getHttpServer())
      .post(`${API}/syllabus-topics`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .send({ class_id: SEED_CLASS_1_ID, subject_id: subjectId, name: 'Reorder B', sequence: 11 })
      .expect(201);

    const reorderRes = await supertest(app.getHttpServer())
      .patch(`${API}/syllabus-topics/reorder`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .send({
        items: [
          { id: a.body.id, sequence: 11 },
          { id: b.body.id, sequence: 10 },
        ],
      })
      .expect(200);

    const swapped = reorderRes.body.find((t: { id: string }) => t.id === a.body.id);
    expect(swapped.sequence).toBe(11);
  });

  // ---- 66.0 D16: write scope for TEACHER -----------------------------------
  // `subjectId` is mapped as SUBJECT_TEACHER in SEED_SECTION_1 (class 1);
  // `otherSubjectId` and class 2 are not.
  describe('write scope (D16)', () => {
    let otherSubjectId: string;
    let teacherRowId: string;

    async function mapTeacher(assignmentType: string, withSubject: boolean) {
      const teacherId = randomUUID();
      await dataSource.query(
        `WITH sp AS (
           INSERT INTO staff_profiles (id, user_id, tenant_id, employee_id, created_at, updated_at)
           VALUES (gen_random_uuid(), $2::uuid, $3::uuid, 'EMP-E2E-' || $1, NOW(), NOW())
           ON CONFLICT (user_id) DO UPDATE SET updated_at = NOW()
           RETURNING id
         )
         INSERT INTO teachers (id, user_id, employee_id, designations, tenant_id, staff_profile_id, created_at, updated_at)
         SELECT $1::uuid, $2::uuid, 'E2E-SYL-TEACHER', '{}', $3::uuid, sp.id, NOW(), NOW() FROM sp`,
        [teacherId, SEED_ADMIN_USER_ID, SEED_TENANT_ID],
      );
      teacherRowId = randomUUID();
      await dataSource.query(
        `INSERT INTO teacher_class_sections (id, teacher_id, section_id, tenant_id, subject_id, assignment_type, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [
          teacherRowId,
          teacherId,
          SEED_SECTION_1_ID,
          SEED_TENANT_ID,
          withSubject ? subjectId : null,
          assignmentType,
        ],
      );
    }

    beforeEach(async () => {
      const r = await dataSource.query(
        `INSERT INTO subjects (id, tenant_id, name_en, code, created_at, updated_at)
         VALUES (DEFAULT, $1, 'Syllabus Other', 'SYLOTH', NOW(), NOW()) RETURNING id`,
        [SEED_TENANT_ID],
      );
      otherSubjectId = r[0].id;
    });

    const call = (
      method: 'post' | 'patch' | 'delete',
      path: string,
      role: string,
      body?: object,
      tenantId: string | null = SEED_TENANT_ID,
    ) => {
      const req = supertest(app.getHttpServer())
        [method](`${API}/syllabus-topics${path}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Role', role);
      if (tenantId) req.set('X-Tenant-ID', tenantId);
      return body ? req.send(body) : req;
    };
    const newTopic = (classId: string, subj: string, name: string, sequence = 1) =>
      dataSource
        .query(
          `INSERT INTO syllabus_topics (id, tenant_id, class_id, subject_id, name, sequence, status, created_at, updated_at)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'PLANNED', NOW(), NOW()) RETURNING id`,
          [SEED_TENANT_ID, classId, subj, name, sequence],
        )
        .then((r: { id: string }[]) => r[0]!.id);
    const nameOf = (id: string) =>
      dataSource
        .query(`SELECT name FROM syllabus_topics WHERE id = $1`, [id])
        .then((r: { name: string }[]) => r[0]?.name ?? null);
    const body = (subj: string) => ({
      class_id: SEED_CLASS_1_ID,
      subject_id: subj,
      name: 'Scoped',
      sequence: 1,
    });

    it('POST: ADMIN 201, mapped TEACHER 201, unmapped TEACHER 403', async () => {
      await mapTeacher('SUBJECT_TEACHER', true);
      await call('post', '', UserRole.ADMIN, body(otherSubjectId)).expect(201);
      await call('post', '', UserRole.TEACHER, body(subjectId)).expect(201);
      const res = await call('post', '', UserRole.TEACHER, body(otherSubjectId)).expect(403);
      expect(res.body.details?.code ?? res.body.message?.details?.code).toBe(
        'SYLLABUS_OUT_OF_SCOPE',
      );
    });

    it('POST: homeroom-only TEACHER 403', async () => {
      await mapTeacher('CLASS_TEACHER', false);
      await call('post', '', UserRole.TEACHER, body(subjectId)).expect(403);
    });

    it.each([
      UserRole.EXECUTIVE,
      UserRole.ACCOUNTANT,
      UserRole.OFFICE_STAFF,
      UserRole.EXAM_CONTROLLER,
      UserRole.COMMITTEE,
      UserRole.PARENT,
      UserRole.STUDENT,
    ])('POST: %s 403 (PermissionsGuard)', async (role) => {
      await call('post', '', role, body(subjectId)).expect(403);
    });

    it('PATCH :id and DELETE :id: ADMIN / mapped ok, unmapped 403 and row unchanged', async () => {
      await mapTeacher('SUBJECT_TEACHER', true);
      const own = await newTopic(SEED_CLASS_1_ID, subjectId, 'own');
      const foreign = await newTopic(SEED_CLASS_1_ID, otherSubjectId, 'foreign');
      const otherClass = await newTopic(SEED_CLASS_2_ID, subjectId, 'otherclass');

      await call('patch', `/${own}`, UserRole.TEACHER, { name: 'edited' }).expect(200);
      expect(await nameOf(own)).toBe('edited');
      for (const id of [foreign, otherClass]) {
        await call('patch', `/${id}`, UserRole.TEACHER, { name: 'hack' }).expect(403);
        await call('delete', `/${id}`, UserRole.TEACHER).expect(403);
        expect(await nameOf(id)).not.toBe('hack');
        expect(await nameOf(id)).not.toBeNull();
      }
      await call('delete', `/${own}`, UserRole.TEACHER).expect(200);
      await call('delete', `/${foreign}`, UserRole.ADMIN).expect(200);
      expect(await nameOf(own)).toBeNull();
    });

    it('PATCH reorder: mapped ok; mixed pairs 403 and nothing changes', async () => {
      await mapTeacher('SUBJECT_TEACHER', true);
      const a = await newTopic(SEED_CLASS_1_ID, subjectId, 'a', 1);
      const b = await newTopic(SEED_CLASS_1_ID, otherSubjectId, 'b', 2);
      await call('patch', '/reorder', UserRole.TEACHER, {
        items: [{ id: a, sequence: 5 }],
      }).expect(200);
      await call('patch', '/reorder', UserRole.TEACHER, {
        items: [
          { id: a, sequence: 9 },
          { id: b, sequence: 8 },
        ],
      }).expect(403);
      const rows = await dataSource.query(
        `SELECT id, sequence FROM syllabus_topics WHERE id = ANY($1)`,
        [[a, b]],
      );
      expect(rows.find((r: { id: string }) => r.id === a).sequence).toBe(5);
      expect(rows.find((r: { id: string }) => r.id === b).sequence).toBe(2);
    });

    it('GET stays 200 for an unmapped TEACHER, PARENT and STUDENT', async () => {
      for (const role of [UserRole.TEACHER, UserRole.PARENT, UserRole.STUDENT]) {
        await supertest(app.getHttpServer())
          .get(`${API}/syllabus-topics`)
          .set('Authorization', `Bearer ${adminToken}`)
          .set('X-Tenant-ID', SEED_TENANT_ID)
          .set('X-Role', role)
          .expect(200);
      }
    });

    it('cross-tenant: other tenant 404, non-member tenant 401, missing header 401, topic survives', async () => {
      const id = await newTopic(SEED_CLASS_1_ID, subjectId, 'tenant1');
      const OTHER_TENANT = '00000000-0000-4000-8000-000000000099';
      await dataSource.query(
        `INSERT INTO schools (id, name, slug, created_at, updated_at)
         VALUES ($1, 'Other', 'other-syl', NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [OTHER_TENANT],
      );
      await dataSource.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [SEED_ADMIN_USER_ID, OTHER_TENANT, UserRole.TEACHER],
      );
      adminToken = await login(SEED_ADMIN_EMAIL); // re-login: token carries memberships
      // Member of tenant 2: tenant-1 id is not visible there -> 404.
      await call('delete', `/${id}`, UserRole.TEACHER, undefined, OTHER_TENANT).expect(404);
      // Not a member of a random tenant: ContextGuard answers 401 (not 403 as the ticket assumed).
      await call('delete', `/${id}`, UserRole.TEACHER, undefined, randomUUID()).expect(401);
      await call('delete', `/${id}`, UserRole.TEACHER, undefined, null).expect(401);
      expect(await nameOf(id)).toBe('tenant1');
    });
  });
});
