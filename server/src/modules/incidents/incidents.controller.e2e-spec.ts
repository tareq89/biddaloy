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
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
} from '@test/constants';

/** [28.2.x] Incidents: ACR gate, subject-can't-read-own (D2, D15), tenant isolation. */

const API = '/api/v1';
const TENANT_B = '00000000-0000-4000-8000-0000001c0001';
const SUBJECT_ID = '00000000-0000-4000-8000-0000001c0010';
const SUBJECT_EMAIL = 'incident-subject@e2e.example';
const TEACHER_ID = '00000000-0000-4000-8000-0000001c0011';
const TEACHER_EMAIL = 'incident-teacher@e2e.example';
const PARENT_ID = '00000000-0000-4000-8000-0000001c0013';
const OTHER_TENANT_STAFF = '00000000-0000-4000-8000-0000001c0012';

describe('incidents (28.2.x)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let adminToken: string;
  let subjectToken: string;
  let teacherToken: string;

  const as = (req: supertest.Test, token: string, role: UserRole) =>
    req
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .set('X-Role', role);

  async function login(email: string): Promise<string> {
    const res = await supertest(app.getHttpServer())
      .post(`${API}/auth/login`)
      .send({ email, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    return res.body.access_token;
  }

  async function addUser(id: string, email: string, tenantId: string, role: UserRole) {
    await ds.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'Incident E2E User', 'ACTIVE', NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [id, email, SEED_ADMIN_PASSWORD_HASH],
    );
    await ds.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [id, tenantId, role],
    );
  }

  async function insertIncident(tenantId: string, staffId: string): Promise<string> {
    const r = await ds.query(
      `INSERT INTO staff_incidents (tenant_id, staff_user_id, type, severity, body, occurred_on, reported_by)
       VALUES ($1, $2, 'BEHAVIOUR', 'LOW', 'e2e body', '2026-09-30', $2) RETURNING id`,
      [tenantId, staffId],
    );
    return r[0].id;
  }

  beforeAll(async () => {
    const fixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = fixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    ds = app.get(DataSource);

    await ds.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, 'Incident Other School', 'incident-other-school', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [TENANT_B],
    );
    await addUser(SUBJECT_ID, SUBJECT_EMAIL, SEED_TENANT_ID, UserRole.ADMIN);
    await addUser(TEACHER_ID, TEACHER_EMAIL, SEED_TENANT_ID, UserRole.TEACHER);
    await addUser(OTHER_TENANT_STAFF, 'incident-other@e2e.example', TENANT_B, UserRole.ADMIN);

    adminToken = await login(SEED_ADMIN_EMAIL);
    subjectToken = await login(SUBJECT_EMAIL);
    teacherToken = await login(TEACHER_EMAIL);
  }, 120000);

  afterAll(async () => {
    await ds.query(`DELETE FROM staff_incidents WHERE tenant_id IN ($1, $2)`, [
      SEED_TENANT_ID,
      TENANT_B,
    ]);
    await app.close();
  });

  const body = {
    staffId: SUBJECT_ID,
    type: 'BEHAVIOUR',
    severity: 'MEDIUM',
    occurredOn: '2026-09-30',
    description: 'Late three days running',
  };

  it('ADMIN reports and reads an incident about someone else', async () => {
    const created = await as(
      supertest(app.getHttpServer()).post(`${API}/incidents`),
      adminToken,
      UserRole.ADMIN,
    )
      .send(body)
      .expect(201);
    expect(created.body.staffId).toBe(SUBJECT_ID);
    expect(created.body.description).toBe(body.description);

    await as(
      supertest(app.getHttpServer()).get(`${API}/incidents/${created.body.id}`),
      adminToken,
      UserRole.ADMIN,
    ).expect(200);

    const list = await as(
      supertest(app.getHttpServer()).get(`${API}/incidents`).query({ staffUserId: SUBJECT_ID }),
      adminToken,
      UserRole.ADMIN,
    ).expect(200);
    expect(list.body.map((i: { id: string }) => i.id)).toContain(created.body.id);
  });

  it('rejects a non-empty attachments field (400)', async () => {
    await as(supertest(app.getHttpServer()).post(`${API}/incidents`), adminToken, UserRole.ADMIN)
      .send({ ...body, attachments: ['x'] })
      .expect(400);
  });

  it('rejects an impossible calendar date (400)', async () => {
    await as(supertest(app.getHttpServer()).post(`${API}/incidents`), adminToken, UserRole.ADMIN)
      .send({ ...body, occurredOn: '2026-02-31' })
      .expect(400);
  });

  it('a non-staff (PARENT) subject is 404 on create', async () => {
    await addUser(PARENT_ID, 'incident-parent@e2e.example', SEED_TENANT_ID, UserRole.PARENT);
    await as(supertest(app.getHttpServer()).post(`${API}/incidents`), adminToken, UserRole.ADMIN)
      .send({ ...body, staffId: PARENT_ID })
      .expect(404);
  });

  it('subject gets 404 on their own incident and it is omitted from their list', async () => {
    const id = await insertIncident(SEED_TENANT_ID, SUBJECT_ID);

    await as(
      supertest(app.getHttpServer()).get(`${API}/incidents/${id}`),
      subjectToken,
      UserRole.ADMIN,
    ).expect(404);

    const list = await as(
      supertest(app.getHttpServer()).get(`${API}/incidents`),
      subjectToken,
      UserRole.ADMIN,
    ).expect(200);
    expect(list.body.map((i: { id: string }) => i.id)).not.toContain(id);
  });

  it('TEACHER is denied on every route (RolesGuard 401 — @Roles(ADMIN) mirrors ACR holders)', async () => {
    const id = await insertIncident(SEED_TENANT_ID, SUBJECT_ID);
    await as(
      supertest(app.getHttpServer()).post(`${API}/incidents`),
      teacherToken,
      UserRole.TEACHER,
    )
      .send(body)
      .expect(401);
    await as(
      supertest(app.getHttpServer()).get(`${API}/incidents`),
      teacherToken,
      UserRole.TEACHER,
    ).expect(401);
    await as(
      supertest(app.getHttpServer()).get(`${API}/incidents/${id}`),
      teacherToken,
      UserRole.TEACHER,
    ).expect(401);
  });

  it('cross-tenant: another tenant’s incident is 404 and absent from the list; cross-tenant subject is 404 on create', async () => {
    const id = await insertIncident(TENANT_B, OTHER_TENANT_STAFF);

    await as(
      supertest(app.getHttpServer()).get(`${API}/incidents/${id}`),
      adminToken,
      UserRole.ADMIN,
    ).expect(404);

    const list = await as(
      supertest(app.getHttpServer()).get(`${API}/incidents`),
      adminToken,
      UserRole.ADMIN,
    ).expect(200);
    expect(list.body.map((i: { id: string }) => i.id)).not.toContain(id);

    await as(supertest(app.getHttpServer()).post(`${API}/incidents`), adminToken, UserRole.ADMIN)
      .send({ ...body, staffId: OTHER_TENANT_STAFF })
      .expect(404);
  });
});
