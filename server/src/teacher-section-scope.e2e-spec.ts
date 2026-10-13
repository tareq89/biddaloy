import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UserRole } from '@biddaloy/shared';
import { AppModule } from './app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from './validation-pipe';
import { SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD, SEED_TENANT_ID } from '@test/constants';
import {
  createTeacherScopeFixture,
  TeacherScopeFixture,
} from '@test/helpers/teacher-scope.fixture';

/**
 * Epic 75 (75.6): a TEACHER reads students, guardians, enrollments, notes and records only for
 * sections they are assigned to in the CURRENT academic year. Every other student is a 404 (D13).
 *
 * Fixture: the teacher has a SUBJECT row in section A (current year), nothing in section B, and
 * a CLASS_TEACHER row in section C (a past academic year). One student and guardian per section.
 */
const API = '/api/v1';
const UUID_MISSING = '00000000-0000-4000-8000-00000000dead';

describe('Teacher section scope (75.6)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let fx: TeacherScopeFixture;
  let teacherToken: string;
  let adminToken: string;

  const call = (
    method: 'get' | 'post' | 'delete',
    path: string,
    token: string,
    role: UserRole,
    tenantId = SEED_TENANT_ID,
  ) =>
    supertest(app.getHttpServer())
      [method](`${API}${path}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', tenantId)
      .set('X-Role', role);
  const asTeacher = (method: 'get' | 'post' | 'delete', path: string) =>
    call(method, path, teacherToken, UserRole.TEACHER);
  const asAdmin = (method: 'get' | 'post' | 'delete', path: string) =>
    call(method, path, adminToken, UserRole.ADMIN);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    dataSource = app.get(DataSource);

    fx = await createTeacherScopeFixture(app, dataSource);
    teacherToken = await fx.login();
    const res = await supertest(app.getHttpServer())
      .post(`${API}/auth/login`)
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    adminToken = res.body.access_token;
  }, 120000);

  afterAll(async () => {
    await fx?.cleanup();
    await app?.close();
  });

  // students / guardians / teacher rows are truncated before every test.
  beforeEach(async () => {
    await fx.seed();
  });

  const idsOf = (rows: { id: string }[]) => rows.map((r) => r.id).sort();

  describe('TEACHER', () => {
    // The repro for the ticket: before 75.6 this was a 403 for the section, a 200 for the id.
    it('a teacher of section A cannot read a student of section B', async () => {
      await asTeacher('get', `/students/${fx.studentB}`).expect(404);
    });

    it('GET /students lists only section A', async () => {
      const res = await asTeacher('get', '/students?limit=100').expect(200);
      const ours = res.body.data.filter((s: { id: string }) =>
        [fx.studentA, fx.studentB, fx.studentC].includes(s.id),
      );
      expect(idsOf(ours)).toEqual([fx.studentA]);
      expect(
        res.body.data.every(
          (s: { class_section_id: string }) => s.class_section_id === fx.sectionA,
        ),
      ).toBe(true);
    });

    it('GET /students/ids returns only section A', async () => {
      const res = await asTeacher('get', '/students/ids').expect(200);
      expect(res.body.ids).toEqual([fx.studentA]);
    });

    it('GET /students/:id is 200 for A, 404 for B, 404 for a past-year section C, 404 for a missing id', async () => {
      await asTeacher('get', `/students/${fx.studentA}`).expect(200);
      await asTeacher('get', `/students/${fx.studentB}`).expect(404);
      await asTeacher('get', `/students/${fx.studentC}`).expect(404);
      await asTeacher('get', `/students/${UUID_MISSING}`).expect(404);
    });

    // D13: "not yours" must look exactly like "does not exist", body included, so a teacher can't probe.
    it('GET /students/:id and /guardians/:id: the 404 body for B equals the body for a missing id', async () => {
      const body = async (path: string) => {
        const {
          path: _p,
          timestamp: _t,
          ...rest
        } = (await asTeacher('get', path).expect(404)).body as Record<string, unknown>;
        return rest;
      };
      expect(await body(`/students/${fx.studentB}`)).toEqual(
        await body(`/students/${UUID_MISSING}`),
      );
      expect(await body(`/guardians/${fx.guardianB}`)).toEqual(
        await body(`/guardians/${UUID_MISSING}`),
      );
    });

    it('GET /students/:id/photo is 404 for B', async () => {
      await asTeacher('get', `/students/${fx.studentB}/photo`).expect(404);
    });

    it('GET /guardians lists only the guardian of A; GET /guardians/:id is 404 for B and C', async () => {
      const res = await asTeacher('get', '/guardians?limit=100').expect(200);
      expect(idsOf(res.body.data)).toEqual([fx.guardianA]);
      await asTeacher('get', `/guardians/${fx.guardianA}`).expect(200);
      await asTeacher('get', `/guardians/${fx.guardianB}`).expect(404);
      await asTeacher('get', `/guardians/${fx.guardianC}`).expect(404);
    });

    it('enrollments: 404 for B on both routes, 200 for A', async () => {
      await asTeacher('get', `/enrollments/student/${fx.studentA}`).expect(200);
      await asTeacher('get', `/enrollments/student/${fx.studentB}`).expect(404);
      await asTeacher('get', `/enrollments/${fx.studentA}/current`).expect(200);
      await asTeacher('get', `/enrollments/${fx.studentB}/current`).expect(404);
    });

    it('notes: allowed on A; GET, POST and DELETE on B are 404', async () => {
      await asTeacher('post', `/students/${fx.studentA}/notes`).send({ body: 'ok' }).expect(201);
      await asTeacher('get', `/students/${fx.studentA}/notes`).expect(200);
      await asTeacher('get', `/students/${fx.studentB}/notes`).expect(404);
      await asTeacher('post', `/students/${fx.studentB}/notes`).send({ body: 'no' }).expect(404);
      await asTeacher('delete', `/students/${fx.studentB}/notes/${UUID_MISSING}`).expect(404);
      await asTeacher('get', `/students/${fx.studentC}/notes`).expect(404);
    });

    it('lifecycle-events and public-exams: 404 for B, 200 for A', async () => {
      await asTeacher('get', `/students/${fx.studentA}/lifecycle-events`).expect(200);
      await asTeacher('get', `/students/${fx.studentB}/lifecycle-events`).expect(404);
      await asTeacher('get', `/students/${fx.studentA}/public-exams`).expect(200);
      await asTeacher('get', `/students/${fx.studentB}/public-exams`).expect(404);
    });

    it('routes that share assertLinked are 404 for B (attendance days, payments by student)', async () => {
      await asTeacher('get', `/attendance/students/${fx.studentB}/days?month=2026-10`).expect(404);
      await asTeacher('get', `/payments/student/${fx.studentB}`).expect(404);
    });

    it('a teacher with no assignment gets empty lists, not an error', async () => {
      await dataSource.query(`DELETE FROM teacher_class_sections`);
      const students = await asTeacher('get', '/students').expect(200);
      expect(students.body).toMatchObject({ data: [], total: 0 });
      const ids = await asTeacher('get', '/students/ids').expect(200);
      expect(ids.body.ids).toEqual([]);
      const guardians = await asTeacher('get', '/guardians').expect(200);
      expect(guardians.body).toMatchObject({ data: [], total: 0 });
      await asTeacher('get', `/students/${fx.studentA}`).expect(404);
    });
  });

  describe('other roles are unchanged', () => {
    it('ADMIN still sees A, B and C', async () => {
      for (const id of [fx.studentA, fx.studentB, fx.studentC]) {
        await asAdmin('get', `/students/${id}`).expect(200);
        await asAdmin('get', `/enrollments/student/${id}`).expect(200);
        await asAdmin('get', `/students/${id}/notes`).expect(200);
      }
      const list = await asAdmin('get', '/students/ids').expect(200);
      expect(list.body.ids).toEqual(
        expect.arrayContaining([fx.studentA, fx.studentB, fx.studentC]),
      );
      for (const id of [fx.guardianA, fx.guardianB, fx.guardianC]) {
        await asAdmin('get', `/guardians/${id}`).expect(200);
      }
    });
  });

  describe('OFFICE_STAFF is unchanged', () => {
    it('still sees A, B and C', async () => {
      // OFFICE_STAFF has a tenant-wide scope: the teacher rule must not narrow it.
      const office = await dataSource.query(`SELECT id FROM users WHERE email = $1`, [
        SEED_ADMIN_EMAIL,
      ]);
      await dataSource.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [office[0].id, SEED_TENANT_ID, UserRole.OFFICE_STAFF],
      );
      // The JWT carries memberships, so log in again after adding the new one.
      const login = await supertest(app.getHttpServer())
        .post(`${API}/auth/login`)
        .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
        .expect(200);
      const officeToken = login.body.access_token as string;
      for (const id of [fx.studentA, fx.studentB, fx.studentC]) {
        await call('get', `/students/${id}`, officeToken, UserRole.OFFICE_STAFF).expect(200);
      }
    });
  });

  describe('tenant isolation', () => {
    it('a tenant the teacher does not belong to is refused by ContextGuard (401)', async () => {
      await call(
        'get',
        `/students/${fx.studentA}`,
        teacherToken,
        UserRole.TEACHER,
        '00000000-0000-4000-8000-000000000099',
      ).expect(401);
    });
  });
});
