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
  SEED_SECTION_2_ID,
  SEED_CLASS_1_ID,
  SEED_ACADEMIC_YEAR_ID,
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
        .expect(403);
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
          .expect(403);
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

  describe('a student who has left cannot be reactivated by a generic edit', () => {
    async function makeWithdrawnStudent(name: string) {
      const made = await makeStudent(name);
      await as(UserRole.ADMIN, http().post(`/api/v1/students/${made.id}/leave`))
        .send({ type: 'WITHDRAWN', occurred_on: '2026-01-05', reason: 'Moved abroad' })
        .expect(201);
      expect(await studentStatus(made.id)).toBe('INACTIVE');
      return made;
    }
    const enrollmentRows = async (id: string) =>
      (
        await dataSource.query(
          `SELECT enrollment_status FROM enrollments WHERE student_id = $1 ORDER BY created_at`,
          [id],
        )
      ).map((r: { enrollment_status: string }) => r.enrollment_status);

    it('PATCH /students/:id with class_section_id is a 409 and creates no enrollment', async () => {
      const { id } = await makeWithdrawnStudent('Section Move After Leaving');
      const before = await enrollmentRows(id);

      const res = await as(UserRole.ACCOUNTANT, http().patch(`/api/v1/students/${id}`))
        .send({ class_section_id: SEED_SECTION_2_ID })
        .expect(409);

      expect(JSON.stringify(res.body.message)).toContain('Readmit');
      expect(await enrollmentRows(id)).toEqual(before); // no new ACTIVE row
      expect(before).not.toContain('ACTIVE');
      expect(await studentStatus(id)).toBe('INACTIVE');
    });

    it('POST /enrollments for that student is a 409 and creates no enrollment', async () => {
      const { id } = await makeWithdrawnStudent('New Enrollment After Leaving');
      const before = await enrollmentRows(id);

      const res = await as(UserRole.ACCOUNTANT, http().post('/api/v1/enrollments'))
        .send({
          student_id: id,
          class_id: SEED_CLASS_1_ID,
          section_id: SEED_SECTION_1_ID,
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
        })
        .expect(409);

      expect(JSON.stringify(res.body.message)).toContain('Readmit');
      expect(await enrollmentRows(id)).toEqual(before);
      expect(await studentStatus(id)).toBe('INACTIVE');
    });

    it('the proper way back, POST /students/:id/readmit, still works', async () => {
      const { id } = await makeWithdrawnStudent('Proper Readmit');
      await as(UserRole.ADMIN, http().post(`/api/v1/students/${id}/readmit`))
        .send({
          occurred_on: '2026-02-01',
          class_section_id: SEED_SECTION_1_ID,
          reason: 'Returned',
        })
        .expect(201);
      expect(await studentStatus(id)).toBe('ACTIVE');
      expect(await eventCount(id)).toBe(2); // WITHDRAWN + READMITTED
    });

    it('an ACTIVE student can still be moved to another section by an ACCOUNTANT', async () => {
      const { id } = await makeStudent('Ordinary Section Move');
      const res = await as(UserRole.ACCOUNTANT, http().patch(`/api/v1/students/${id}`))
        .send({ class_section_id: SEED_SECTION_2_ID })
        .expect(200);
      expect(res.body.class_section_id).toBe(SEED_SECTION_2_ID);
      expect(await studentStatus(id)).toBe('ACTIVE');
    });
  });

  describe('records edits: audit, empty body, tenant header', () => {
    it('writes an audit row for the change and never copies health_notes into it', async () => {
      const { id } = await makeStudent('Audited Records');

      await as(UserRole.EXECUTIVE, http().patch(`/api/v1/students/${id}/records`))
        .send({ religion: 'Buddhism', health_notes: 'top secret diagnosis' })
        .expect(200);

      const rows = await dataSource.query(
        `SELECT action, performed_by_user_id, old_values, new_values
           FROM audit_logs WHERE entity_type = 'Student' AND entity_id = $1 AND action = 'UPDATE'`,
        [id],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].performed_by_user_id).toBe(SEED_ADMIN_USER_ID);
      expect(rows[0].new_values.religion).toBe('Buddhism');
      expect(Object.keys(rows[0].new_values)).toContain('health_notes'); // recorded as changed...
      expect(JSON.stringify(rows[0])).not.toContain('top secret'); // ...but not the content
    });

    it('re-sending an unchanged date_of_birth writes no audit row; a changed one does', async () => {
      // `date_of_birth` is a DATE column (read back as "YYYY-MM-DD") but the service turns the
      // incoming value into a Date, so a naive comparison always saw a change.
      const made = await as(UserRole.ADMIN, http().post('/api/v1/students'))
        .send({
          full_name: 'DOB Audit',
          class_section_id: SEED_SECTION_1_ID,
          date_of_birth: '2012-03-04',
        })
        .expect(201);
      const id = made.body.id as string;
      const updates = async () =>
        Number(
          (
            await dataSource.query(
              `SELECT count(*) AS n FROM audit_logs WHERE entity_type = 'Student' AND entity_id = $1 AND action = 'UPDATE'`,
              [id],
            )
          )[0].n,
        );

      await as(UserRole.ACCOUNTANT, http().patch(`/api/v1/students/${id}`))
        .send({ full_name: 'DOB Audit', date_of_birth: '2012-03-04' })
        .expect(200);
      expect(await updates()).toBe(0); // nothing actually changed

      await as(UserRole.ACCOUNTANT, http().patch(`/api/v1/students/${id}`))
        .send({ date_of_birth: '2012-03-05' })
        .expect(200);
      expect(await updates()).toBe(1); // a real change is still recorded

      // ...and it lists only the field that changed, not every field the caller did not send.
      const row = (
        await dataSource.query(
          `SELECT old_values, new_values FROM audit_logs WHERE entity_type = 'Student' AND entity_id = $1 AND action = 'UPDATE'`,
          [id],
        )
      )[0];
      expect(Object.keys(row.new_values)).toEqual(['date_of_birth']);
      expect(Object.keys(row.old_values)).toEqual(['date_of_birth']);
    });

    it('an unchanged or empty edit is a 200, not a 500, and writes no audit row', async () => {
      const { id } = await makeStudent('Empty Records Edit');
      await as(UserRole.EXECUTIVE, http().patch(`/api/v1/students/${id}/records`))
        .send({})
        .expect(200);
      const rows = await dataSource.query(
        `SELECT 1 FROM audit_logs WHERE entity_type = 'Student' AND entity_id = $1 AND action = 'UPDATE'`,
        [id],
      );
      expect(rows).toHaveLength(0);
    });

    it('requires the X-Tenant-ID header', async () => {
      const { id } = await makeStudent('Tenant Header');
      await http()
        .patch(`/api/v1/students/${id}/records`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Role', UserRole.EXECUTIVE)
        .send({ religion: 'Islam' })
        .expect(401);
    });

    it('the TEACHER role used above really exists, so its 403s are about permissions', async () => {
      const held = await dataSource.query(
        `SELECT role FROM user_tenants WHERE user_id = $1 AND tenant_id = $2`,
        [SEED_ADMIN_USER_ID, TENANT_ID],
      );
      expect(held.map((r: { role: string }) => r.role)).toEqual(
        expect.arrayContaining(['TEACHER', 'EXECUTIVE', 'ACCOUNTANT']),
      );
    });
  });
});
