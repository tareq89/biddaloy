import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import supertest = require('supertest');
import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { UserRole } from '@biddaloy/shared';
import {
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
  SEED_SECTION_1_ID,
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
    adminToken = await login(SEED_ADMIN_EMAIL);
    parentToken = await login(parentEmail);
    studentToken = await login(studentEmail);
  }, 90000);

  afterAll(async () => {
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
});
