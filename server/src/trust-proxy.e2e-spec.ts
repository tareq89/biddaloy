import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from './app.module';

/**
 * E2E tests for the trust-proxy setting main.ts applies in production.
 *
 * `main.ts`'s `bootstrap()` never runs under the Nest testing harness, so
 * this builds two app instances — one with `trust proxy` set the way
 * production does, one without (matching dev) — and compares what
 * req.ip/req.protocol resolve to given the same spoofed headers, to prove
 * the setting actually changes behavior rather than just not erroring.
 *
 * The route used to read req.ip/req.protocol is a diagnostic-only
 * middleware registered here, not part of production code.
 */
async function createApp(trustProxy: boolean): Promise<INestApplication> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication();
  if (trustProxy) {
    app.set('trust proxy', 1);
  }

  app.use('/__trust-proxy-probe', (req: any, res: any) => {
    res.json({ ip: req.ip, protocol: req.protocol, secure: req.secure });
  });

  await app.init();
  return app;
}

describe('Trust proxy E2E', () => {
  let trustingApp: INestApplication;
  let defaultApp: INestApplication;

  beforeAll(async () => {
    // Populated by test/setup.ts's global setupFile from server/.env.test —
    // see cors.e2e-spec.ts for why this fails fast rather than falling back.
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL must be set for trust-proxy E2E tests — see server/.env.test');
    }
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-production';
    process.env.NODE_ENV = 'test';

    [trustingApp, defaultApp] = await Promise.all([createApp(true), createApp(false)]);
  }, 60000);

  afterAll(async () => {
    await Promise.all([trustingApp.close(), defaultApp.close()]);
  });

  it('with trust proxy set, req.ip reflects X-Forwarded-For rather than the socket peer', async () => {
    const res = await supertest(trustingApp.getHttpServer())
      .get('/__trust-proxy-probe')
      .set('X-Forwarded-For', '203.0.113.7')
      .expect(200);

    expect(res.body.ip).toBe('203.0.113.7');
  });

  it('with trust proxy set, req.protocol/req.secure reflect X-Forwarded-Proto', async () => {
    const res = await supertest(trustingApp.getHttpServer())
      .get('/__trust-proxy-probe')
      .set('X-Forwarded-Proto', 'https')
      .expect(200);

    expect(res.body.protocol).toBe('https');
    expect(res.body.secure).toBe(true);
  });

  it('without trust proxy (dev default), the same headers are ignored', async () => {
    const res = await supertest(defaultApp.getHttpServer())
      .get('/__trust-proxy-probe')
      .set('X-Forwarded-For', '203.0.113.7')
      .set('X-Forwarded-Proto', 'https')
      .expect(200);

    expect(res.body.ip).not.toBe('203.0.113.7');
    expect(res.body.protocol).toBe('http');
    expect(res.body.secure).toBe(false);
  });
});
