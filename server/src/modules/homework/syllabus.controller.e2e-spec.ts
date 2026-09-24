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
  SEED_CLASS_1_ID,
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

  it('a STUDENT can read syllabus topics but cannot create one (401, RolesGuard)', async () => {
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
      .expect(401);
  });

  it('a PARENT can read syllabus topics but cannot delete one (401, RolesGuard)', async () => {
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

    await supertest(app.getHttpServer())
      .get(`${API}/syllabus-topics`)
      .query({ class_id: SEED_CLASS_1_ID, subject_id: subjectId })
      .set('Authorization', `Bearer ${parentToken}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .set('X-Role', UserRole.PARENT)
      .expect(200);

    await supertest(app.getHttpServer())
      .delete(`${API}/syllabus-topics/${createRes.body.id}`)
      .set('Authorization', `Bearer ${parentToken}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .set('X-Role', UserRole.PARENT)
      .expect(401);
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
});
