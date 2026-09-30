import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { DataSource } from 'typeorm';
import { UserRole } from '@biddaloy/shared';
import { randomUUID } from 'crypto';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_USER_ID,
  SEED_ADMIN_PASSWORD,
  SEED_SECTION_1_ID,
} from '@test/constants';

/**
 * [39.2.1 / 39.2.4] Two access rules, proved over real HTTP with real roles:
 *
 *  1. A student's enrollment status can only change through the lifecycle operations
 *     (POST /students/:id/leave, /readmit). The generic PATCH endpoints used to accept
 *     `enrollment_status`, so an ACCOUNTANT (STUDENT_UPDATE, no STUDENT_LIFECYCLE_MANAGE) could
 *     write GRADUATED directly: no reason, no date, no lifecycle event.
 *  2. The profile-records save is its own route, so an EXECUTIVE (STUDENT_RECORDS_WRITE, no
 *     STUDENT_UPDATE) can edit records without general student updates.
 */
describe('Student status + records access E2E', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let token: string;

  const TENANT_ID = SEED_TENANT_ID;

  beforeAll(async () => {
    process.env.DATABASE_URL =
      process.env.DATABASE_URL || 'postgres://postgres:***@localhost:5432/biddaloy';
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-production';
    process.env.NODE_ENV = 'test';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    dataSource = app.get(DataSource);

    // One user holding every role under test; X-Role picks which one a request acts as.
    for (const role of [UserRole.ACCOUNTANT, UserRole.EXECUTIVE, UserRole.TEACHER]) {
      await dataSource.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW())
         ON CONFLICT DO NOTHING`,
        [SEED_ADMIN_USER_ID, TENANT_ID, role],
      );
    }
    const login = await supertest(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    token = login.body.access_token;
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  const as = (role: UserRole, req: supertest.Test) =>
    req.set('Authorization', `Bearer ${token}`).set('X-Tenant-ID', TENANT_ID).set('X-Role', role);
  const http = () => supertest(app.getHttpServer());

  async function makeStudent(name: string) {
    const res = await as(UserRole.ADMIN, http().post('/api/v1/students'))
      .send({ full_name: name, class_section_id: SEED_SECTION_1_ID })
      .expect(201);
    const enrollment = await dataSource.query(
      `SELECT id, enrollment_status FROM enrollments WHERE student_id = $1`,
      [res.body.id],
    );
    return { id: res.body.id as string, enrollmentId: enrollment[0].id as string };
  }

  const studentStatus = async (id: string) =>
    (await dataSource.query(`SELECT enrollment_status FROM students WHERE id = $1`, [id]))[0]
      .enrollment_status;
  const enrollmentStatus = async (id: string) =>
    (await dataSource.query(`SELECT enrollment_status FROM enrollments WHERE id = $1`, [id]))[0]
      .enrollment_status;
  const eventCount = async (id: string) =>
    Number(
      (
        await dataSource.query(
          `SELECT count(*) AS n FROM student_lifecycle_events WHERE student_id = $1`,
          [id],
        )
      )[0].n,
    );

  describe('generic PATCH endpoints no longer change a status', () => {
    for (const role of [UserRole.ACCOUNTANT, UserRole.ADMIN]) {
      it(`PATCH /students/:id with enrollment_status is a 400 for ${role} and changes nothing`, async () => {
        const { id, enrollmentId } = await makeStudent(`Status Bypass ${role}`);

        const res = await as(role, http().patch(`/api/v1/students/${id}`))
          .send({ enrollment_status: 'GRADUATED' })
          .expect(400);

        expect(JSON.stringify(res.body.message)).toContain('enrollment_status');
        expect(await studentStatus(id)).toBe('ACTIVE');
        expect(await enrollmentStatus(enrollmentId)).toBe('ACTIVE');
        expect(await eventCount(id)).toBe(0);
      });

      it(`PATCH /enrollments/:id with enrollment_status is a 400 for ${role} and changes nothing`, async () => {
        const { id, enrollmentId } = await makeStudent(`Enrollment Bypass ${role}`);

        const res = await as(role, http().patch(`/api/v1/enrollments/${enrollmentId}`))
          .send({ enrollment_status: 'INACTIVE' })
          .expect(400);

        expect(JSON.stringify(res.body.message)).toContain('enrollment_status');
        expect(await enrollmentStatus(enrollmentId)).toBe('ACTIVE');
        expect(await studentStatus(id)).toBe('ACTIVE');
        expect(await eventCount(id)).toBe(0);
      });
    }

    it('an ordinary edit through the same PATCH still works', async () => {
      const { id } = await makeStudent('Ordinary Edit');
      const res = await as(UserRole.ACCOUNTANT, http().patch(`/api/v1/students/${id}`))
        .send({ full_name: 'Ordinary Edit Renamed' })
        .expect(200);
      expect(res.body.full_name).toBe('Ordinary Edit Renamed');
    });

    it('the lifecycle route still changes the status, with an event, for its own permission', async () => {
      const { id } = await makeStudent('Proper Leave');

      // An ACCOUNTANT lacks STUDENT_LIFECYCLE_MANAGE: refused, nothing changes.
      await as(UserRole.ACCOUNTANT, http().post(`/api/v1/students/${id}/leave`))
        .send({ type: 'WITHDRAWN', occurred_on: '2026-01-05', reason: 'x' })
        .expect(401);
      expect(await studentStatus(id)).toBe('ACTIVE');

      await as(UserRole.ADMIN, http().post(`/api/v1/students/${id}/leave`))
        .send({ type: 'WITHDRAWN', occurred_on: '2026-01-05', reason: 'Moved abroad' })
        .expect(201);
      expect(await studentStatus(id)).toBe('INACTIVE');
      expect(await eventCount(id)).toBe(1);
    });
  });

  describe('PATCH /students/:id/records', () => {
    const body = {
      religion: 'Islam',
      birth_reg_no: '20122604150009999',
      health_notes: 'Wears glasses',
      father_name: 'Karim Uddin',
      mother_name: 'Rahima Khatun',
    };

    it('lets an EXECUTIVE save the five profile fields and read health_notes back', async () => {
      const { id } = await makeStudent('Executive Records');

      const res = await as(UserRole.EXECUTIVE, http().patch(`/api/v1/students/${id}/records`))
        .send({ ...body, birth_reg_no: '20122604150000001' })
        .expect(200);

      expect(res.body).toMatchObject({
        religion: 'Islam',
        health_notes: 'Wears glasses',
        father_name: 'Karim Uddin',
        mother_name: 'Rahima Khatun',
      });
      const row = (
        await dataSource.query(`SELECT religion, health_notes FROM students WHERE id = $1`, [id])
      )[0];
      expect(row).toEqual({ religion: 'Islam', health_notes: 'Wears glasses' });
    });

    it('cannot be used for anything but the five fields (no status, no section move)', async () => {
      const { id } = await makeStudent('Records Only');
      for (const extra of [
        { enrollment_status: 'GRADUATED' },
        { class_section_id: SEED_SECTION_1_ID },
        { full_name: 'Renamed' },
      ]) {
        await as(UserRole.EXECUTIVE, http().patch(`/api/v1/students/${id}/records`))
          .send({ religion: 'Islam', ...extra })
          .expect(400);
      }
      expect(await studentStatus(id)).toBe('ACTIVE');
    });

    it('is refused for roles without STUDENT_RECORDS_WRITE', async () => {
      const { id } = await makeStudent('Records Denied');
      for (const role of [UserRole.ACCOUNTANT, UserRole.TEACHER]) {
        await as(role, http().patch(`/api/v1/students/${id}/records`))
          .send({ religion: 'Islam' })
          .expect(401);
      }
      expect(
        (await dataSource.query(`SELECT religion FROM students WHERE id = $1`, [id]))[0].religion,
      ).toBeNull();
    });

    it('validates the birth registration number and 404s an unknown student', async () => {
      const { id } = await makeStudent('Records Validation');
      await as(UserRole.EXECUTIVE, http().patch(`/api/v1/students/${id}/records`))
        .send({ birth_reg_no: 'abc' })
        .expect(400);
      await as(UserRole.EXECUTIVE, http().patch(`/api/v1/students/${randomUUID()}/records`))
        .send({ religion: 'Islam' })
        .expect(404);
    });

    it('still lets ADMIN in, and an ACCOUNTANT cannot write these fields through PATCH /students/:id either', async () => {
      const { id } = await makeStudent('Records Admin');
      await as(UserRole.ADMIN, http().patch(`/api/v1/students/${id}/records`))
        .send({ religion: 'Hinduism' })
        .expect(200);
      await as(UserRole.ACCOUNTANT, http().patch(`/api/v1/students/${id}`))
        .send({ religion: 'Islam' })
        .expect(403);
    });
  });
});
