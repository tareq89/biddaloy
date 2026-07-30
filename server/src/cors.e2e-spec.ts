import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from './app.module';
import { buildCorsOptions } from './cors-origins';

/**
 * E2E tests for CORS configuration.
 *
 * `main.ts`'s `bootstrap()` never runs under the Nest testing harness, so
 * this calls `buildCorsOptions` — the same helper bootstrap uses — to verify
 * the actual HTTP behavior an allowlisted vs. non-allowlisted origin gets,
 * without duplicating (and risking drifting from) the production options.
 */
describe('CORS E2E', () => {
  let app: INestApplication;
  const allowedOrigin = 'http://localhost:5173';
  const disallowedOrigin = 'http://evil.example.com';

  beforeAll(async () => {
    // Populated by test/setup.ts's global setupFile from server/.env.test
    // before any spec's beforeAll runs — see its comment for why that must
    // happen at module top level. Failing fast here (rather than the
    // fallback other e2e specs use) means a misconfigured .env.test surfaces
    // immediately instead of this suite silently reusing whatever was set.
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL must be set for CORS E2E tests — see server/.env.test');
    }
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-production';
    process.env.NODE_ENV = 'test';
    process.env.CORS_ORIGINS = allowedOrigin;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.enableCors(buildCorsOptions(process.env.CORS_ORIGINS, process.env.NODE_ENV));

    await app.init();
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  it('sets Access-Control-Allow-Origin and -Credentials for an allowlisted origin', async () => {
    const res = await supertest(app.getHttpServer())
      .get('/health')
      .set('Origin', allowedOrigin)
      .expect(200);

    expect(res.headers['access-control-allow-origin']).toBe(allowedOrigin);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('omits Access-Control-Allow-Origin for an origin not on the allowlist', async () => {
    // The route still runs server-side; without the ACAO header a browser
    // refuses to expose the response to client JS, which is the actual
    // rejection mechanism CORS relies on.
    const res = await supertest(app.getHttpServer())
      .get('/health')
      .set('Origin', disallowedOrigin)
      .expect(200);

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('preflight for an allowlisted origin echoes X-Tenant-ID and X-Role in Access-Control-Allow-Headers', async () => {
    const res = await supertest(app.getHttpServer())
      .options('/health')
      .set('Origin', allowedOrigin)
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'X-Tenant-ID, X-Role')
      .expect(204);

    expect(res.headers['access-control-allow-headers']).toContain('X-Tenant-ID');
    expect(res.headers['access-control-allow-headers']).toContain('X-Role');
  });
});
