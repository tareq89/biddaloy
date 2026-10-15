import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as http from 'http';
import type { AddressInfo } from 'net';
import request = require('supertest');
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '../../../test/helpers/e2e-app.helper';
import { demoNoindex } from './demo-noindex.middleware';
import { DEMO_CARDS } from './demo-accounts';

/**
 * Boots the real app (real routing, so case variants reach Express as they would in production)
 * once with DEMO_MODE=true and once without. main.ts mounts `demoNoindex` only in demo mode,
 * so this does the same.
 */
async function boot(demo: boolean): Promise<INestApplication> {
  const fixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = fixture.createNestApplication();
  configureApiVersioning(app);
  if (demo) app.use(demoNoindex);
  await app.init();
  return app;
}

describe('DEMO_MODE on (E2E)', () => {
  let app: INestApplication;
  const saved = { mode: process.env.DEMO_MODE, pass: process.env.DEMO_PASSWORD };

  beforeAll(async () => {
    process.env.DEMO_MODE = 'true';
    process.env.DEMO_PASSWORD = 'demo-pass-1';
    app = await boot(true);
  }, 60000);

  afterAll(async () => {
    await app?.close();
    if (saved.mode === undefined) delete process.env.DEMO_MODE;
    else process.env.DEMO_MODE = saved.mode;
    if (saved.pass === undefined) delete process.env.DEMO_PASSWORD;
    else process.env.DEMO_PASSWORD = saved.pass;
  });

  it('refuses a deny-listed route with 403 DEMO_DISABLED', async () => {
    const res = await request(app.getHttpServer()).post('/api/v1/auth/change-password').send({});
    expect(res.status).toBe(403);
    expect(res.body.details?.code ?? res.body.message?.details?.code).toBe('DEMO_DISABLED');
  });

  it('refuses a case variant of a deny-listed route', async () => {
    const res = await request(app.getHttpServer()).post('/api/v1/AUTH/Change-Password').send({});
    expect(res.status).toBe(403);
  });

  it('lets an allowed route through to its own handling (401, not DEMO_DISABLED)', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/students');
    expect(res.status).toBe(401);
  });

  it('serves the role cards and the password on GET /demo/roles, noindex', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/demo/roles');
    expect(res.status).toBe(200);
    expect(res.body.password).toBe('demo-pass-1');
    expect(res.body.cards).toHaveLength(DEMO_CARDS.length);
    expect(res.headers['x-robots-tag']).toBe('noindex, nofollow');
  });

  it('refuses a multipart upload over 2 MB with DEMO_UPLOAD_LIMIT', async () => {
    // Raw request: the server answers from the header alone and may close the socket before a
    // real 3 MB body is written, which would surface as ECONNRESET with supertest.
    const server = app.getHttpServer();
    if (!server.listening) await new Promise<void>((r) => server.listen(0, r));
    const { port } = server.address() as AddressInfo;
    const { status, body } = await new Promise<{ status: number; body: string }>(
      (resolve, reject) => {
        const req = http.request(
          {
            port,
            method: 'POST',
            path: '/api/v1/schools/me/logo',
            headers: {
              'content-type': 'multipart/form-data; boundary=x',
              'content-length': String(3 * 1024 * 1024),
            },
          },
          (res) => {
            let data = '';
            res.on('data', (c) => (data += c));
            res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
          },
        );
        req.on('error', reject);
        req.write('--x\r\n');
      },
    );
    expect(status).toBe(413);
    expect(JSON.parse(body).details?.code ?? JSON.parse(body).message?.details?.code).toBe(
      'DEMO_UPLOAD_LIMIT',
    );
  });
});

describe('DEMO_MODE off (E2E)', () => {
  let app: INestApplication;
  const saved = process.env.DEMO_MODE;

  beforeAll(async () => {
    delete process.env.DEMO_MODE;
    app = await boot(false);
  }, 60000);

  afterAll(async () => {
    await app?.close();
    if (saved !== undefined) process.env.DEMO_MODE = saved;
  });

  it('404s GET /demo/roles and sets no noindex header', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/demo/roles');
    expect(res.status).toBe(404);
    expect(res.headers['x-robots-tag']).toBeUndefined();
  });

  it('does not deny the routes the demo closes', async () => {
    const res = await request(app.getHttpServer()).post('/api/v1/auth/change-password').send({});
    expect(res.status).not.toBe(403);
  });
});
