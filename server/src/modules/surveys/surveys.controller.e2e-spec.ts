import { randomUUID } from 'crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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
 * E2E for the survey lifecycle: ADMIN create -> publish -> close, TEACHER 403,
 * and a foreign survey id 404s. Cross-tenant isolation is the same
 * `tenant_id`-scoped lookup, unit-tested in surveys.service.spec.ts.
 */
describe('Surveys E2E', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let token: string;
  let teacherId: string;
  let subjectId: string;

  const api = (method: 'get' | 'post', path: string, role: UserRole = UserRole.ADMIN) =>
    supertest(app.getHttpServer())
      [method](`/api/v1${path}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .set('X-Role', role);

  beforeAll(async () => {
    process.env.DATABASE_URL =
      process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/biddaloy';
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-production';
    process.env.NODE_ENV = 'test';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    await app.listen(0);
    dataSource = app.get(DataSource);

    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ('${SEED_ADMIN_USER_ID}', '${SEED_TENANT_ID}', '${UserRole.TEACHER}', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
    );
    const login = await supertest(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    token = login.body.access_token;

    teacherId = randomUUID();
    await dataSource.query(
      `WITH sp AS (
         INSERT INTO staff_profiles (id, user_id, tenant_id, employee_id, created_at, updated_at)
         VALUES (gen_random_uuid(), $2::uuid, $3::uuid, 'EMP-E2E-' || $1, NOW(), NOW())
         ON CONFLICT (user_id) DO UPDATE SET updated_at = NOW()
         RETURNING id
       )
       INSERT INTO teachers (id, user_id, employee_id, designations, tenant_id, staff_profile_id, created_at, updated_at)
       SELECT $1::uuid, $2::uuid, 'E2E-SRV-TEACHER', '{}', $3::uuid, sp.id, NOW(), NOW() FROM sp`,
      [teacherId, SEED_ADMIN_USER_ID, SEED_TENANT_ID],
    );
    subjectId = randomUUID();
    await dataSource.query(
      `INSERT INTO subjects (id, tenant_id, name_en, code, created_at, updated_at)
       VALUES ($1, $2, 'E2E Survey Subject', $3, NOW(), NOW())`,
      [subjectId, SEED_TENANT_ID, `SRV-${randomUUID().slice(0, 8)}`],
    );
    await dataSource.query(
      `INSERT INTO teacher_class_sections (id, teacher_id, section_id, subject_id, tenant_id, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [randomUUID(), teacherId, SEED_SECTION_1_ID, subjectId, SEED_TENANT_ID],
    );
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  const body = () => ({
    title: 'Term 1 feedback',
    anonymous: true,
    respondent: 'STUDENTS',
    questions: [{ text: 'Explains clearly?', starsEnabled: true }],
    targets: [{ teacherId, subjectId }],
  });

  it('TEACHER gets 403 on create', async () => {
    await api('post', '/surveys', UserRole.TEACHER).send(body()).expect(403);
  });

  it('ADMIN create -> publish -> close, edit blocked once OPEN', async () => {
    const created = await api('post', '/surveys').send(body()).expect(201);
    expect(created.body.status).toBe('DRAFT');
    expect(created.body.min_responses).toBe(5);
    const id = created.body.id;

    await api('post', `/surveys/${id}/publish`).expect(201);
    const fetched = await api('get', `/surveys/${id}`).expect(200);
    expect(fetched.body.status).toBe('OPEN');
    expect(fetched.body.questions).toHaveLength(1);

    await supertest(app.getHttpServer())
      .patch(`/api/v1/surveys/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .set('X-Role', UserRole.ADMIN)
      .send({ title: 'nope' })
      .expect(400);

    const closed = await api('post', `/surveys/${id}/close`).expect(201);
    expect(closed.body.status).toBe('CLOSED');
  });

  it('400 when a target is not a real assignment', async () => {
    await api('post', '/surveys')
      .send({ ...body(), targets: [{ teacherId: randomUUID(), subjectId }] })
      .expect(400);
  });

  it('404 for a survey id outside this tenant', async () => {
    await api('get', `/surveys/${randomUUID()}`).expect(404);
  });
});
