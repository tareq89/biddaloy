import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { DataSource } from 'typeorm';
import { UserRole } from '@biddaloy/shared';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
} from '@test/constants';

// [78 D37] Role fixtures for the readiness route, plus a second school.
const OFFICE_STAFF_ID = '00000000-0000-4000-8000-00000000c694';
const OFFICE_STAFF_EMAIL = 'sms-readiness-office@e2e.example';
const TEACHER_ID = '00000000-0000-4000-8000-00000000c695';
const TEACHER_EMAIL = 'sms-readiness-teacher@e2e.example';
const TENANT_B = '00000000-0000-4000-8000-00000000c696';
const ADMIN_B_ID = '00000000-0000-4000-8000-00000000c697';
const ADMIN_B_EMAIL = 'sms-readiness-admin-b@e2e.example';

/**
 * Regression: `GET /communications/sms-credits` (CreditsController) used to be
 * captured by `CommunicationsController`'s `@Get(':id')` + ParseUUIDPipe and
 * answered 400 "uuid is expected", because Nest matches in controller
 * registration order and CreditsController lived in a later module.
 */
describe('GET /communications/sms-credits route order E2E', () => {
  let app: INestApplication;
  let token: string;
  let dataSource: DataSource | undefined;

  async function loginAs(email: string): Promise<string> {
    const res = await supertest(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    return res.body.access_token;
  }

  async function upsertUser(id: string, email: string, tenantId: string, role: UserRole) {
    await dataSource!.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'SMS Readiness E2E', 'ACTIVE', NOW(), NOW())
       ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, status = 'ACTIVE'`,
      [id, email, SEED_ADMIN_PASSWORD_HASH],
    );
    await dataSource!.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [id, tenantId, role],
    );
  }

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL must be set to run e2e tests');
    }
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-production';
    process.env.NODE_ENV = 'test';
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    const login = await supertest(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    token = login.body.access_token;
    dataSource = app.get(DataSource);
    await dataSource.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, 'SMS Readiness School B', 'sms-readiness-b', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [TENANT_B],
    );
    await upsertUser(OFFICE_STAFF_ID, OFFICE_STAFF_EMAIL, SEED_TENANT_ID, UserRole.OFFICE_STAFF);
    await upsertUser(TEACHER_ID, TEACHER_EMAIL, SEED_TENANT_ID, UserRole.TEACHER);
    await upsertUser(ADMIN_B_ID, ADMIN_B_EMAIL, TENANT_B, UserRole.ADMIN);
  }, 60000);

  afterAll(async () => {
    // Guarded: a beforeAll that failed before `app.get(DataSource)` must surface
    // its own error, not a TypeError from here, and must still close the app.
    if (dataSource) {
      for (const id of [OFFICE_STAFF_ID, TEACHER_ID, ADMIN_B_ID]) {
        await dataSource.query(`DELETE FROM refresh_tokens WHERE user_id = $1`, [id]);
        await dataSource.query(`DELETE FROM user_tenants WHERE user_id = $1`, [id]);
        await dataSource.query(`UPDATE users SET status = 'INACTIVE' WHERE id = $1`, [id]);
      }
      await dataSource.query(`DELETE FROM schools WHERE id = $1`, [TENANT_B]);
    }
    await app?.close();
  });

  // [78 D37] GET /communications/sms-credits/readiness
  describe('readiness', () => {
    const readiness = (bearer: string, tenantId: string = SEED_TENANT_ID) =>
      supertest(app.getHttpServer())
        .get('/api/v1/communications/sms-credits/readiness')
        .set('Authorization', `Bearer ${bearer}`)
        .set('X-Tenant-ID', tenantId);

    it('ADMIN gets 200 NO_GATEWAY on the seed school, which has no SMS set-up', async () => {
      const res = await readiness(token).expect(200);
      expect(res.body).toEqual({ sms: 'NO_GATEWAY' });
    });

    it('OFFICE_STAFF (COMMUNICATION_SEND, no credit read) gets the same 200', async () => {
      const res = await readiness(await loginAs(OFFICE_STAFF_EMAIL)).expect(200);
      expect(res.body).toEqual({ sms: 'NO_GATEWAY' });
    });

    it('TEACHER gets 403', async () => {
      await readiness(await loginAs(TEACHER_EMAIL)).expect(403);
    });

    it('a missing or invalid X-Tenant-ID is rejected', async () => {
      await supertest(app.getHttpServer())
        .get('/api/v1/communications/sms-credits/readiness')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
      await readiness(token, 'not-a-uuid').expect(401);
    });

    it("tenant isolation: school B's answer reflects B's own settings, not A's", async () => {
      // B owns a Greenweb key (saved through the real settings route, so it is
      // encrypted the way the resolver reads it) and is unmetered, so B is
      // exactly READY while A, with no gateway, stays NO_GATEWAY. A controller
      // that ignored tenant.id would answer the same for both.
      const tokenB = await loginAs(ADMIN_B_EMAIL);
      await supertest(app.getHttpServer())
        .patch(`/api/v1/schools/${TENANT_B}/settings`)
        .set('Authorization', `Bearer ${tokenB}`)
        .set('X-Tenant-ID', TENANT_B)
        .send({
          version: 1,
          communications: {
            sms: { provider: 'greenweb', greenweb: { apiKey: 'sms-readiness-b-key' } },
          },
        })
        .expect(200);
      const resB = await readiness(tokenB, TENANT_B).expect(200);
      expect(resB.body).toEqual({ sms: 'READY' });
      const resA = await readiness(token).expect(200);
      expect(resA.body).toEqual({ sms: 'NO_GATEWAY' });
      // B's admin cannot read A's answer at all: ContextGuard refuses a tenant
      // the caller does not belong to with 401, before any permission check.
      await readiness(tokenB, SEED_TENANT_ID).expect(401);
    });
  });

  it('returns the credits summary shape, not the :id UUID 400', async () => {
    const res = await supertest(app.getHttpServer())
      .get('/api/v1/communications/sms-credits')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .expect(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        metering: expect.stringMatching(/^(OFF|PLATFORM)$/),
        available: expect.any(Number),
        reserved: expect.any(Number),
        ledger: expect.objectContaining({ data: expect.any(Array), total: expect.any(Number) }),
      }),
    );
  });

  it('GET /communications/:uuid still reaches the log lookup (404 for unknown id)', async () => {
    await supertest(app.getHttpServer())
      .get(`/api/v1/communications/${randomUUID()}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .expect(404);
  });

  it('GET /communications/not-a-uuid still 400s via ParseUUIDPipe', async () => {
    await supertest(app.getHttpServer())
      .get('/api/v1/communications/not-a-uuid')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .expect(400);
  });
});
