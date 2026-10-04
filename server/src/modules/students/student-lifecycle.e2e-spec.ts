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
  SEED_SECTION_1_ID,
} from '@test/constants';

/**
 * [39.2.7] Happy-path journeys across the whole Epic 39 surface:
 * leave -> events -> readmit -> events -> report, plus notes and public exams.
 * Guard/validation edge cases live in student-lifecycle.controller.e2e-spec.ts.
 * Denied roles get 401 from RolesGuard, not 403.
 */
describe('Student lifecycle (e2e journey)', () => {
  let app: INestApplication;
  let token: string;
  // Global beforeEach wipes students, so each test creates its own.
  let studentId: string;

  const http = () => supertest(app.getHttpServer());
  const as = (req: supertest.Test, role: UserRole) =>
    req
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .set('X-Role', role);

  beforeEach(async () => {
    const created = await as(http().post('/api/v1/students'), UserRole.ADMIN)
      .send({ full_name: 'Lifecycle Journey', class_section_id: SEED_SECTION_1_ID })
      .expect(201);
    studentId = created.body.id;
  });

  beforeAll(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-production';
    process.env.NODE_ENV = 'test';
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();

    const ds = app.get(DataSource);
    for (const role of [UserRole.EXECUTIVE, UserRole.TEACHER]) {
      await ds.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ('${SEED_ADMIN_USER_ID}', '${SEED_TENANT_ID}', '${role}', NOW(), NOW())
         ON CONFLICT DO NOTHING`,
      );
    }
    const login = await http()
      .post('/api/v1/auth/login')
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    token = login.body.access_token;
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  it('leave -> events -> readmit -> events -> report counts', async () => {
    const leave = await as(http().post(`/api/v1/students/${studentId}/leave`), UserRole.ADMIN)
      .send({ type: 'WITHDRAWN', occurred_on: '2026-03-01', reason: 'moved away' })
      .expect(201);
    expect(leave.body.event_type).toBe('WITHDRAWN');
    const yearId: string = leave.body.academic_year_id;

    const afterLeave = await as(
      http().get(`/api/v1/students/${studentId}/lifecycle-events`),
      UserRole.ADMIN,
    ).expect(200);
    expect(afterLeave.body.map((e: { event_type: string }) => e.event_type)).toEqual(['WITHDRAWN']);

    const readmit = await as(http().post(`/api/v1/students/${studentId}/readmit`), UserRole.ADMIN)
      .send({ occurred_on: '2026-03-02', class_section_id: SEED_SECTION_1_ID })
      .expect(201);
    expect(readmit.body.academic_year_id).toBe(yearId);

    const afterReadmit = await as(
      http().get(`/api/v1/students/${studentId}/lifecycle-events`),
      UserRole.ADMIN,
    ).expect(200);
    expect(afterReadmit.body).toHaveLength(2);
    expect(afterReadmit.body.map((e: { event_type: string }) => e.event_type).sort()).toEqual([
      'READMITTED',
      'WITHDRAWN',
    ]);

    // EXECUTIVE may read the report (business rule: reports are ADMIN + EXECUTIVE).
    const report = await as(
      http().get(`/api/v1/admission/reports/lifecycle?academic_year_id=${yearId}`),
      UserRole.EXECUTIVE,
    ).expect(200);
    expect(report.body.counts).toMatchObject({
      withdrawn: 1,
      readmitted: 1,
      transferred_out: 0,
      graduated: 0,
    });
  });

  it('unauthorised role cannot record leave (TEACHER -> 403)', async () => {
    await as(http().post(`/api/v1/students/${studentId}/leave`), UserRole.TEACHER)
      .send({ type: 'WITHDRAWN', occurred_on: '2026-03-01', reason: 'x' })
      .expect(403);
  });

  it('note round-trip: create -> list -> delete -> gone', async () => {
    const created = await as(http().post(`/api/v1/students/${studentId}/notes`), UserRole.ADMIN)
      .send({ body: 'Needs extra reading support' })
      .expect(201);
    expect(created.body.body).toBe('Needs extra reading support');

    const listed = await as(
      http().get(`/api/v1/students/${studentId}/notes`),
      UserRole.ADMIN,
    ).expect(200);
    expect(listed.body.map((n: { id: string }) => n.id)).toContain(created.body.id);

    await as(
      http().delete(`/api/v1/students/${studentId}/notes/${created.body.id}`),
      UserRole.ADMIN,
    ).expect(204);

    const after = await as(
      http().get(`/api/v1/students/${studentId}/notes`),
      UserRole.ADMIN,
    ).expect(200);
    expect(after.body.map((n: { id: string }) => n.id)).not.toContain(created.body.id);
  });

  it('public-exam round-trip: create -> list -> delete -> gone', async () => {
    const created = await as(
      http().post(`/api/v1/students/${studentId}/public-exams`),
      UserRole.ADMIN,
    )
      .send({
        exam_type: 'SSC',
        board: 'Dhaka',
        roll_no: '123456',
        registration_no: '1234567890',
        gpa: 4.5,
        passing_year: 2024,
      })
      .expect(201);
    expect(created.body).toMatchObject({ exam_type: 'SSC', board: 'Dhaka', passing_year: 2024 });

    const listed = await as(
      http().get(`/api/v1/students/${studentId}/public-exams`),
      UserRole.TEACHER,
    ).expect(200);
    expect(listed.body.map((e: { id: string }) => e.id)).toContain(created.body.id);

    // Nest's default status for DELETE without @HttpCode is 200.
    await as(
      http().delete(`/api/v1/students/${studentId}/public-exams/${created.body.id}`),
      UserRole.ADMIN,
    ).expect(200);

    const after = await as(
      http().get(`/api/v1/students/${studentId}/public-exams`),
      UserRole.TEACHER,
    ).expect(200);
    expect(after.body.map((e: { id: string }) => e.id)).not.toContain(created.body.id);
  });
});
