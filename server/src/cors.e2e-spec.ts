import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from './app.module';
import { resolveCorsOrigins } from './cors-origins';

/**
 * E2E tests for CORS configuration.
 *
 * `main.ts`'s `bootstrap()` never runs under the Nest testing harness, so
 * this reproduces the same `resolveCorsOrigins` + `app.enableCors(...)` call
 * bootstrap makes, to verify the actual HTTP behavior an allowlisted vs.
 * non-allowlisted origin gets.
 */
describe('CORS E2E', () => {
  let app: INestApplication;
  const allowedOrigin = 'http://localhost:5173';
  const disallowedOrigin = 'http://evil.example.com';

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:***@localhost:5432/betonboi';
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-production';
    process.env.NODE_ENV = 'test';
    process.env.CORS_ORIGINS = allowedOrigin;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();

    const corsOrigins = resolveCorsOrigins(process.env.CORS_ORIGINS, process.env.NODE_ENV);
    app.enableCors({
      origin: corsOrigins,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Tenant-ID', 'X-Role'],
    });

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
