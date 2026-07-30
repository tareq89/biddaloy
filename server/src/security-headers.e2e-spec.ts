import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { buildHelmetOptions } from './security-headers';

/**
 * E2E tests for the security headers main.ts registers via helmet.
 *
 * `main.ts`'s `bootstrap()` never runs under the Nest testing harness, so
 * this calls `buildHelmetOptions` — the same helper bootstrap uses — against
 * two configs (production and dev) to verify the actual HTTP response
 * headers, particularly that HSTS only appears in production.
 */
async function createApp(nodeEnv: string): Promise<INestApplication> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication();
  app.use(helmet(buildHelmetOptions(nodeEnv)));
  await app.init();
  return app;
}

describe('Security headers E2E', () => {
  let prodApp: INestApplication;
  let devApp: INestApplication;

  beforeAll(async () => {
    // Populated by test/setup.ts's global setupFile from server/.env.test —
    // see cors.e2e-spec.ts for why this fails fast rather than falling back.
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL must be set for security-headers E2E tests — see server/.env.test');
    }
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-production';

    [prodApp, devApp] = await Promise.all([createApp('production'), createApp('development')]);
  }, 60000);

  afterAll(async () => {
    await Promise.all([prodApp.close(), devApp.close()]);
  });

  it('sets a same-origin-only Content-Security-Policy', async () => {
    const res = await supertest(prodApp.getHttpServer()).get('/health').expect(200);

    const csp = res.headers['content-security-policy'];
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain('unsafe-inline');
  });

  it('removes X-Powered-By', async () => {
    const res = await supertest(prodApp.getHttpServer()).get('/health').expect(200);

    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('sets X-Frame-Options to DENY, X-Content-Type-Options to nosniff, and a no-referrer policy', async () => {
    const res = await supertest(prodApp.getHttpServer()).get('/health').expect(200);

    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
  });

  it('disables the legacy X-XSS-Protection filter rather than omitting the header', async () => {
    const res = await supertest(prodApp.getHttpServer()).get('/health').expect(200);

    expect(res.headers['x-xss-protection']).toBe('0');
  });

  it('sets Strict-Transport-Security in production', async () => {
    const res = await supertest(prodApp.getHttpServer()).get('/health').expect(200);

    expect(res.headers['strict-transport-security']).toBe('max-age=31536000; includeSubDomains');
  });

  it('does not set Strict-Transport-Security outside production', async () => {
    const res = await supertest(devApp.getHttpServer()).get('/health').expect(200);

    expect(res.headers['strict-transport-security']).toBeUndefined();
  });
});
