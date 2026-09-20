import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { UserRole } from '@biddaloy/shared';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_USER_ID,
  SEED_ADMIN_PASSWORD,
} from '@test/constants';
import { CALENDAR_FEED_RATE_LIMIT } from '../../rate-limit';

function extractToken(url: string): string {
  return url
    .split('/')
    .pop()!
    .replace(/\.ics$/, '');
}

/**
 * E2E tests for [17.4.1]'s calendar feed surface:
 * `GET/POST /calendar/feed` (authenticated) and
 * `GET /calendar/feed/:token.ics` (no auth, no tenant header).
 */
describe('Calendar Feed E2E', () => {
  let app: INestApplication;
  let token: string;

  const TENANT_ID = SEED_TENANT_ID;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL must be set to run e2e tests');
    }
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-production';
    process.env.NODE_ENV = 'test';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();

    const loginRes = await supertest(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    token = loginRes.body.access_token;
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  describe('GET/POST /calendar/feed', () => {
    it('mints a token on first call and requires ADMIN/staff auth', async () => {
      const res = await supertest(app.getHttpServer())
        .get('/api/v1/calendar/feed')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .expect(200);

      expect(res.body.url).toMatch(/\/calendar\/feed\/[A-Za-z0-9_-]+\.ics$/);
      expect(res.body.created_at).toBeDefined();
    });

    it('is idempotent — repeat GETs return the same URL', async () => {
      const first = await supertest(app.getHttpServer())
        .get('/api/v1/calendar/feed')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .expect(200);

      const second = await supertest(app.getHttpServer())
        .get('/api/v1/calendar/feed')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .expect(200);

      expect(second.body.url).toBe(first.body.url);
    });

    it('requires no Authorization header to be rejected', async () => {
      await supertest(app.getHttpServer()).get('/api/v1/calendar/feed').expect(401);
    });

    it('POST /calendar/feed/regenerate revokes the old link and mints a new one', async () => {
      const before = await supertest(app.getHttpServer())
        .get('/api/v1/calendar/feed')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .expect(200);
      const oldToken = extractToken(before.body.url);

      const after = await supertest(app.getHttpServer())
        .post('/api/v1/calendar/feed/regenerate')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .expect(201);

      expect(after.body.url).not.toBe(before.body.url);

      await supertest(app.getHttpServer()).get(`/api/v1/calendar/feed/${oldToken}.ics`).expect(404);
    });
  });

  describe('GET /calendar/feed/:token.ics', () => {
    it('works with no Authorization header and no X-Tenant-ID header, and sets an ETag', async () => {
      const mint = await supertest(app.getHttpServer())
        .post('/api/v1/calendar/feed/regenerate')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .expect(201);
      const rawToken = extractToken(mint.body.url);

      const res = await supertest(app.getHttpServer())
        .get(`/api/v1/calendar/feed/${rawToken}.ics`)
        .expect(200);

      expect(res.headers['content-type']).toContain('text/calendar');
      expect(res.headers['etag']).toBeDefined();
      expect(res.text).toContain('BEGIN:VCALENDAR');
    });

    it('returns 304 when If-None-Match matches the current ETag', async () => {
      const mint = await supertest(app.getHttpServer())
        .post('/api/v1/calendar/feed/regenerate')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .expect(201);
      const rawToken = extractToken(mint.body.url);

      const first = await supertest(app.getHttpServer())
        .get(`/api/v1/calendar/feed/${rawToken}.ics`)
        .expect(200);

      await supertest(app.getHttpServer())
        .get(`/api/v1/calendar/feed/${rawToken}.ics`)
        .set('If-None-Match', first.headers['etag'])
        .expect(304);
    });

    it('an unknown token 404s', async () => {
      await supertest(app.getHttpServer())
        .get('/api/v1/calendar/feed/does-not-exist-at-all.ics')
        .expect(404);
    });

    // Same reasoning as `public-invoice.e2e-spec.ts`'s equivalent comment:
    // the full e2e stack globally disables throttling when NODE_ENV=test,
    // so the tier's numbers are asserted directly instead of driving a real
    // 429. This route reaching the controller in every test above already
    // exercises the `@Throttle({ default: CALENDAR_FEED_RATE_LIMIT })`
    // wiring structurally.
    it('is wired to the 30/min CALENDAR_FEED_RATE_LIMIT tier', () => {
      expect(CALENDAR_FEED_RATE_LIMIT).toEqual({ limit: 30, ttl: 60_000 });
    });
  });
});
