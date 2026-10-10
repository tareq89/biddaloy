import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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
  SEED_TENANT_ID,
} from '@test/constants';

/**
 * [52.3.5] Route order and role gate. `pending-count` / `reports` are literal paths that must
 * beat `GET /applications/:id` (ParseUUIDPipe would answer 400).
 */
describe('Application reports E2E', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  const API = '/api/v1/applications';
  const tokens: Partial<Record<UserRole, string>> = {};
  const roles = [
    UserRole.TEACHER,
    UserRole.PARENT,
    UserRole.STUDENT,
    UserRole.ACCOUNTANT,
    UserRole.EXECUTIVE,
    UserRole.OFFICE_STAFF,
  ] as const;

  async function login(email: string): Promise<string> {
    const res = await supertest(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    return res.body.access_token;
  }
  const get = (path: string, role: UserRole) =>
    supertest(app.getHttpServer())
      .get(`${API}/${path}`)
      .set('Authorization', `Bearer ${tokens[role]}`)
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

    tokens[UserRole.ADMIN] = await login(SEED_ADMIN_EMAIL);
    for (const role of roles) {
      const id = randomUUID();
      const email = `rep-e2e-${id}@test.com`;
      await dataSource.query(
        `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'ACTIVE', NOW(), NOW())`,
        [id, email, SEED_ADMIN_PASSWORD_HASH, `E2E ${role}`],
      );
      await dataSource.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW())`,
        [id, SEED_TENANT_ID, role],
      );
      tokens[role] = await login(email);
    }
  }, 90000);

  afterAll(async () => {
    await app.close();
  });

  it('GET pending-count is 200 (not a 400 from /:id) for TEACHER, PARENT and STUDENT', async () => {
    for (const role of [UserRole.TEACHER, UserRole.PARENT, UserRole.STUDENT]) {
      const res = await get('pending-count', role);
      expect(res.status, role).toBe(200);
      expect(res.body).toEqual({ total: 0, by_type: [], oldest_pending_at: null });
    }
  });

  it('GET reports is 200 for ADMIN, EXECUTIVE and OFFICE_STAFF', async () => {
    for (const role of [UserRole.ADMIN, UserRole.EXECUTIVE, UserRole.OFFICE_STAFF]) {
      const res = await get('reports', role);
      expect(res.status, role).toBe(200);
      expect(res.body).toHaveProperty('on_leave_today');
    }
  });

  it('GET reports is 403 for TEACHER, ACCOUNTANT and PARENT', async () => {
    for (const role of [UserRole.TEACHER, UserRole.ACCOUNTANT, UserRole.PARENT]) {
      expect((await get('reports', role)).status, role).toBe(403);
    }
  });

  it('GET reports rejects a malformed date with 400', async () => {
    expect((await get('reports?from=yesterday', UserRole.ADMIN)).status).toBe(400);
  });
});
