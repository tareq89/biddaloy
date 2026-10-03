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
 * [39.2.1] Guards + validation only. The full leave/readmit flow is covered by
 * student-lifecycle.integration.spec.ts (and #1192's student-lifecycle.e2e-spec.ts).
 * Denied roles get 401 from RolesGuard (see students.e2e-spec.ts), not 403.
 */
describe('StudentLifecycleController (guards)', () => {
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
  const body = { type: 'WITHDRAWN', occurred_on: '2026-03-01', reason: 'moved' };

  beforeEach(async () => {
    const created = await as(http().post('/api/v1/students'), UserRole.ADMIN)
      .send({ full_name: 'Lifecycle Guard', class_section_id: SEED_SECTION_1_ID })
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
    for (const role of [UserRole.EXECUTIVE, UserRole.TEACHER, UserRole.ACCOUNTANT]) {
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

  it('ADMIN leave returns 201 with event_type', async () => {
    const res = await as(http().post(`/api/v1/students/${studentId}/leave`), UserRole.ADMIN)
      .send(body)
      .expect(201);
    expect(res.body.event_type).toBe('WITHDRAWN');
  });

  it('EXECUTIVE readmit returns 201', async () => {
    await as(http().post(`/api/v1/students/${studentId}/leave`), UserRole.ADMIN)
      .send(body)
      .expect(201);
    const res = await as(http().post(`/api/v1/students/${studentId}/readmit`), UserRole.EXECUTIVE)
      .send({ occurred_on: '2026-03-02', class_section_id: SEED_SECTION_1_ID })
      .expect(201);
    expect(res.body.event_type).toBe('READMITTED');
  });

  it('TEACHER leave returns 403', async () => {
    const res = await as(http().post(`/api/v1/students/${studentId}/leave`), UserRole.TEACHER)
      .send(body)
      .expect(403);
    expect(res.body.message).toContain('Requires permission(s)');
  });

  it('ACCOUNTANT readmit returns 403', async () => {
    const res = await as(http().post(`/api/v1/students/${studentId}/readmit`), UserRole.ACCOUNTANT)
      .send({ occurred_on: '2026-03-02', class_section_id: SEED_SECTION_1_ID })
      .expect(403);
    expect(res.body.message).toContain('Requires permission(s)');
  });

  it('ACCOUNTANT lifecycle-events returns 403', async () => {
    const res = await as(
      http().get(`/api/v1/students/${studentId}/lifecycle-events`),
      UserRole.ACCOUNTANT,
    ).expect(403);
    expect(res.body.message).toContain('Requires permission(s)');
  });

  it('TEACHER lifecycle-events returns 200', async () => {
    await as(http().post(`/api/v1/students/${studentId}/leave`), UserRole.ADMIN)
      .send(body)
      .expect(201);
    const res = await as(
      http().get(`/api/v1/students/${studentId}/lifecycle-events`),
      UserRole.TEACHER,
    ).expect(200);
    expect(res.body).toHaveLength(1);
  });

  it('missing X-Tenant-ID returns 401', async () => {
    await http()
      .get(`/api/v1/students/${studentId}/lifecycle-events`)
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
  });

  it('non-member X-Tenant-ID returns 401', async () => {
    await http()
      .get(`/api/v1/students/${studentId}/lifecycle-events`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', '39210000-0000-4000-8000-0000000000ff')
      .set('X-Role', UserRole.ADMIN)
      .expect(401);
  });

  it('non-UUID :id returns 400', async () => {
    await as(http().post('/api/v1/students/not-a-uuid/leave'), UserRole.ADMIN)
      .send(body)
      .expect(400);
  });

  it('future occurred_on returns 400', async () => {
    await as(http().post(`/api/v1/students/${studentId}/leave`), UserRole.ADMIN)
      .send({ ...body, occurred_on: '2999-01-01' })
      .expect(400);
  });
});
