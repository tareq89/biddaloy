import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from './app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from './validation-pipe';
import { UserRole } from '@biddaloy/shared';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
  SEED_SECTION_1_ID,
} from '@test/constants';

/**
 * [#1364] Guard-level proof of how the three new roles meet the ROLE_NARROWINGS routes.
 * Deliberately stops at the guards: object-level service scoping is #1362's job, so a
 * "reached" assertion here only means "not 401/403", never that the data came back.
 */
const API = '/api/v1';
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000999';

const USERS = {
  [UserRole.OFFICE_STAFF]: {
    id: '00000000-0000-4000-8000-0000013640a1',
    email: 'nr1364-office@e2e.example',
  },
  [UserRole.EXAM_CONTROLLER]: {
    id: '00000000-0000-4000-8000-0000013640a2',
    email: 'nr1364-exam@e2e.example',
  },
  [UserRole.COMMITTEE]: {
    id: '00000000-0000-4000-8000-0000013640a3',
    email: 'nr1364-committee@e2e.example',
  },
} as const;

describe('[#1364] new roles vs ROLE_NARROWINGS routes', () => {
  let app: INestApplication;
  const tokens: Record<string, string> = {};
  const http = () => supertest(app.getHttpServer());

  const call = (role: UserRole, method: 'get' | 'post' | 'patch', path: string, body?: object) =>
    http()
      [method](`${API}${path}`)
      .set('Authorization', `Bearer ${tokens[role]}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .send(body);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    const dataSource = app.get(DataSource);

    for (const [role, u] of Object.entries(USERS)) {
      await dataSource.query(
        `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'ACTIVE', NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [u.id, u.email, SEED_ADMIN_PASSWORD_HASH, `NR1364 ${role}`],
      );
      await dataSource.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [u.id, SEED_TENANT_ID, role],
      );
      const res = await http()
        .post(`${API}/auth/login`)
        .send({ email: u.email, password: SEED_ADMIN_PASSWORD })
        .expect(200);
      tokens[role] = res.body.access_token;
    }
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  const notBlocked = (status: number) => expect([401, 403]).not.toContain(status);

  it('EXAM_CONTROLLER reaches results review and publish, never writes marks', async () => {
    const R = UserRole.EXAM_CONTROLLER;
    notBlocked((await call(R, 'get', `/exams/${UNKNOWN_ID}/results`)).status);
    notBlocked((await call(R, 'post', `/exams/${UNKNOWN_ID}/results/publish`)).status);
    expect((await call(R, 'patch', `/exams/${UNKNOWN_ID}/marks`, {})).status).toBe(403);
    expect((await call(R, 'post', `/exams/${UNKNOWN_ID}/marks/reopen`, {})).status).toBe(403);
  });

  it('OFFICE_STAFF creates a student but cannot generate fees or see run history', async () => {
    const R = UserRole.OFFICE_STAFF;
    const created = await call(R, 'post', '/students', {
      full_name: 'NR1364 Student',
      class_section_id: SEED_SECTION_1_ID,
      date_of_birth: '2010-05-15',
    });
    expect(created.status).toBe(201);
    notBlocked((await call(R, 'get', '/students')).status);
    expect((await call(R, 'post', '/fees/generate', {})).status).toBe(403);
    expect((await call(R, 'patch', `/fees/generations/${UNKNOWN_ID}`, {})).status).toBe(403);
    expect((await call(R, 'get', '/fees/generations')).status).toBe(403);
    expect((await call(R, 'post', `/invoices/${UNKNOWN_ID}/send`, {})).status).toBe(403);
  });

  it('COMMITTEE reaches none of the student or results staff routes', async () => {
    const R = UserRole.COMMITTEE;
    expect((await call(R, 'get', '/students')).status).toBe(403);
    expect((await call(R, 'get', `/exams/${UNKNOWN_ID}/results`)).status).toBe(403);
    expect((await call(R, 'get', '/attendance/my-sections')).status).toBe(403);
  });
});
