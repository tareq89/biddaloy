import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { SEED_TENANT_ID, SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD } from '@test/constants';

/**
 * Regression: `GET /communications/sms-credits` (CreditsController) used to be
 * captured by `CommunicationsController`'s `@Get(':id')` + ParseUUIDPipe and
 * answered 400 "uuid is expected", because Nest matches in controller
 * registration order and CreditsController lived in a later module.
 */
describe('GET /communications/sms-credits route order E2E', () => {
  let app: INestApplication;
  let token: string;

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
  });

  afterAll(async () => {
    await app.close();
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
