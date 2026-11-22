import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { DAILY_LIMIT_MAX, DAILY_LIMITS_PLATFORM_KEY } from '@biddaloy/shared';
import { AppModule } from '../../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../../validation-pipe';
import { mintCockpitToken, removeCockpitOwners } from '@test/helpers/cockpit-token.helper';
import { SEED_TENANT_ID, SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD } from '@test/constants';

const SCHOOL_B = randomUUID();
const API = '/api/v1';

describe('platform daily limits routes E2E', () => {
  let app: INestApplication;
  let ds: DataSource;
  let owner: string;
  let schoolAdmin: string;
  const http = () => supertest(app.getHttpServer());

  beforeAll(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-production';
    process.env.NODE_ENV = 'test';
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    ds = app.get(DataSource);
    await ds.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, 'Limits School B', $2, NOW(), NOW())`,
      [SCHOOL_B, `limits-b-${SCHOOL_B.slice(0, 8)}`],
    );
    owner = await mintCockpitToken(app, ds);
    const login = await http()
      .post(`${API}/auth/login`)
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    schoolAdmin = login.body.access_token;
  });

  afterAll(async () => {
    await ds.query(`DELETE FROM platform_settings WHERE key = $1`, [DAILY_LIMITS_PLATFORM_KEY]);
    await removeCockpitOwners(ds);
    await app.close();
  });

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const audits = async (action: string) =>
    Number(
      (await ds.query(`SELECT COUNT(*)::int AS n FROM audit_logs WHERE action = $1`, [action]))[0]
        .n,
    );

  it('owner PUT platform default: effective changes for a school with no override; audited', async () => {
    const before = await audits('PLATFORM_SETTINGS_CHANGED');
    const put = await http()
      .put(`${API}/platform/settings/daily-limits`)
      .set(auth(owner))
      .send({ sms: 111, showRemaining: true })
      .expect(200);
    expect(put.body.stored).toEqual({ sms: 111, showRemaining: true });
    expect(put.body.usedToday).toBeNull();
    const school = await http()
      .get(`${API}/platform/schools/${SCHOOL_B}/daily-limits`)
      .set(auth(owner))
      .expect(200);
    expect(school.body.effective.sms).toBe(111);
    expect(school.body.effective.showRemaining).toBe(true);
    expect(await audits('PLATFORM_SETTINGS_CHANGED')).toBe(before + 1);
    // null removes the value again
    const cleared = await http()
      .put(`${API}/platform/settings/daily-limits`)
      .set(auth(owner))
      .send({ sms: null })
      .expect(200);
    expect(cleared.body.stored).toEqual({ showRemaining: true });
    expect(cleared.body.effective.sms).toBe(2000);
  });

  it('owner PUT school A override leaves school B unchanged; audited', async () => {
    const before = await audits('SETTINGS_CHANGE');
    const put = await http()
      .put(`${API}/platform/schools/${SEED_TENANT_ID}/daily-limits`)
      .set(auth(owner))
      .send({ email: 7 })
      .expect(200);
    expect(put.body.stored.email).toBe(7);
    expect(put.body.effective.email).toBe(7);
    expect(put.body.usedToday).toEqual({ sms: 0, email: 0, whatsapp: 0 });
    const b = await http()
      .get(`${API}/platform/schools/${SCHOOL_B}/daily-limits`)
      .set(auth(owner))
      .expect(200);
    expect(b.body.effective.email).toBe(2000);
    expect(await audits('SETTINGS_CHANGE')).toBeGreaterThan(before);
    // null removes the school value, falling back
    const cleared = await http()
      .put(`${API}/platform/schools/${SEED_TENANT_ID}/daily-limits`)
      .set(auth(owner))
      .send({ email: null })
      .expect(200);
    expect(cleared.body.stored).toEqual({});
    expect(cleared.body.effective.email).toBe(2000);
  });

  it('school admin token gets 403 on every route', async () => {
    for (const [m, p] of [
      ['get', '/platform/settings/daily-limits'],
      ['put', '/platform/settings/daily-limits'],
      ['get', `/platform/schools/${SCHOOL_B}/daily-limits`],
      ['put', `/platform/schools/${SCHOOL_B}/daily-limits`],
    ] as const) {
      await (http() as any)
        [m](`${API}${p}`)
        .set(auth(schoolAdmin))
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .send({})
        .expect(403);
    }
  });

  it('missing or invalid token gets 401', async () => {
    await http().get(`${API}/platform/settings/daily-limits`).expect(401);
    await http()
      .put(`${API}/platform/schools/${SCHOOL_B}/daily-limits`)
      .set(auth('not-a-token'))
      .send({})
      .expect(401);
  });

  it('non-UUID id is 400, unknown school is 404 with no write', async () => {
    await http()
      .get(`${API}/platform/schools/not-a-uuid/daily-limits`)
      .set(auth(owner))
      .expect(400);
    await http()
      .put(`${API}/platform/schools/${randomUUID()}/daily-limits`)
      .set(auth(owner))
      .send({ sms: 5 })
      .expect(404);
    await http()
      .get(`${API}/platform/schools/${randomUUID()}/daily-limits`)
      .set(auth(owner))
      .expect(404);
  });

  it('rejects bad bodies: above max, negative, fractional, unknown key', async () => {
    for (const body of [
      { sms: DAILY_LIMIT_MAX + 1 },
      { email: -1 },
      { whatsapp: 1.5 },
      { sms: 1, bogus: 1 },
    ]) {
      await http()
        .put(`${API}/platform/settings/daily-limits`)
        .set(auth(owner))
        .send(body)
        .expect(400);
    }
  });
});
