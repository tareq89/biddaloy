import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import supertest = require('supertest');
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { CommunicationMedium, UserRole } from '@biddaloy/shared';
import { AppModule } from '../../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../../validation-pipe';
import { TenantSettingsCache } from '../../schools/settings/tenant-settings-cache.service';
import { SendLimitService } from './send-limit.service';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
} from '@test/constants';

const TEACHER_ID = '00000000-0000-4000-8000-00000000d255';
const TEACHER_EMAIL = 'daily-today-teacher@e2e.example';
const TENANT_B = randomUUID();
const ADMIN_B_ID = randomUUID();
const ADMIN_B_EMAIL = 'daily-today-admin-b@e2e.example';
const URL = '/api/v1/communications/daily-limits/today';

describe('GET /communications/daily-limits/today E2E (#4255)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let admin: string;
  let limits: SendLimitService;
  const http = () => supertest(app.getHttpServer());
  const cache = () => app.get(TenantSettingsCache, { strict: false });
  const get = (t: string, tenant: string = SEED_TENANT_ID) =>
    http().get(URL).set('Authorization', `Bearer ${t}`).set('X-Tenant-ID', tenant);
  const login = async (email: string) =>
    (
      await http()
        .post('/api/v1/auth/login')
        .send({ email, password: SEED_ADMIN_PASSWORD })
        .expect(200)
    ).body.access_token as string;

  /** Merge `communications` into a school's settings and drop the cached copy. */
  async function setComms(id: string, comms: Record<string, unknown>) {
    await ds.query(
      `UPDATE schools SET settings = COALESCE(settings, '{}'::jsonb) || jsonb_build_object('communications', $2::jsonb) WHERE id = $1`,
      [id, JSON.stringify(comms)],
    );
    cache().invalidate(id);
  }
  const platformSms = (extra: Record<string, unknown> = {}) => ({
    sms: { source: 'SCHOOLMANAGERP', metering: 'PLATFORM' },
    dailyLimits: { sms: 10, showRemaining: true, ...extra },
  });

  beforeAll(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-production';
    process.env.NODE_ENV = 'test';
    process.env.GREENWEB_API_KEY = 'e2e-platform-key';
    process.env.SMS_PROVIDER = 'greenweb';
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    ds = app.get(DataSource);
    limits = app.get(SendLimitService, { strict: false });
    await ds.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at) VALUES ($1, 'Today B', $2, NOW(), NOW())`,
      [TENANT_B, `today-b-${TENANT_B.slice(0, 8)}`],
    );
    for (const [id, email, tenant, role] of [
      [TEACHER_ID, TEACHER_EMAIL, SEED_TENANT_ID, UserRole.TEACHER],
      [ADMIN_B_ID, ADMIN_B_EMAIL, TENANT_B, UserRole.ADMIN],
    ] as const) {
      await ds.query(
        `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
         VALUES ($1, $2, $3, 'Today E2E', 'ACTIVE', NOW(), NOW())
         ON CONFLICT (id) DO UPDATE SET status = 'ACTIVE'`,
        [id, email, SEED_ADMIN_PASSWORD_HASH],
      );
      await ds.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [id, tenant, role],
      );
    }
    admin = await login(SEED_ADMIN_EMAIL);
  }, 60000);

  afterEach(async () => {
    await ds.query(
      `UPDATE schools SET settings = settings - 'communications' WHERE id IN ($1, $2)`,
      [SEED_TENANT_ID, TENANT_B],
    );
    cache().invalidate(SEED_TENANT_ID);
    cache().invalidate(TENANT_B);
  });

  afterAll(async () => {
    delete process.env.GREENWEB_API_KEY;
    delete process.env.SMS_PROVIDER;
    for (const id of [TEACHER_ID, ADMIN_B_ID]) {
      await ds.query(`DELETE FROM refresh_tokens WHERE user_id = $1`, [id]);
      await ds.query(`DELETE FROM user_tenants WHERE user_id = $1`, [id]);
      await ds.query(`UPDATE users SET status = 'INACTIVE' WHERE id = $1`, [id]);
    }
    // School B stays: audit_logs rows (from the login) restrict its delete; the run's DB is dropped.
    await app.close();
  });

  it('switch off: nothing about the limit is sent', async () => {
    await setComms(SEED_TENANT_ID, platformSms({ showRemaining: false }));
    const res = await get(admin).expect(200);
    expect(res.body).toEqual({ show: false, channels: {} });
    expect(res.headers['cache-control']).toContain('no-store');
  });

  it('switch on, platform SMS: limit/used/left match the counter', async () => {
    await setComms(SEED_TENANT_ID, platformSms({ sms: 50 }));
    await limits.tryCount(SEED_TENANT_ID, CommunicationMedium.SMS);
    await limits.tryCount(SEED_TENANT_ID, CommunicationMedium.SMS);
    const counter = await limits.remaining(SEED_TENANT_ID, CommunicationMedium.SMS);
    const res = await get(admin).expect(200);
    expect(res.body.show).toBe(true);
    expect(res.body.channels.sms).toEqual({
      limit: 50,
      used: 50 - counter.remaining,
      left: counter.remaining,
    });
    expect(res.body.channels.sms.used).toBeGreaterThanOrEqual(2);
  });

  it("a channel on the school's own account is not listed", async () => {
    await setComms(SEED_TENANT_ID, {
      sms: { source: 'OWN', metering: 'OFF' },
      dailyLimits: { sms: 10, showRemaining: true },
    });
    const res = await get(admin).expect(200);
    expect(res.body).toEqual({ show: true, channels: {} });
  });

  it('a user without COMMUNICATION_SEND gets 403', async () => {
    await get(await login(TEACHER_EMAIL)).expect(403);
  });

  it('missing X-Tenant-ID and a malformed or unknown one are all refused, nothing echoed', async () => {
    await http().get(URL).set('Authorization', `Bearer ${admin}`).expect(401);
    const bad = await get(admin, 'not-a-uuid-zzz').expect(401);
    expect(JSON.stringify(bad.body)).not.toContain('not-a-uuid-zzz');
    const unknown = await get(admin, randomUUID());
    expect([401, 403, 404]).toContain(unknown.status);
  });

  it("tenant B never sees tenant A's count", async () => {
    await setComms(SEED_TENANT_ID, platformSms());
    await setComms(TENANT_B, platformSms());
    await limits.tryCount(SEED_TENANT_ID, CommunicationMedium.SMS);
    const a = (await get(admin).expect(200)).body.channels.sms.used;
    const b = (await get(await login(ADMIN_B_EMAIL), TENANT_B).expect(200)).body.channels.sms.used;
    expect(a).toBeGreaterThanOrEqual(1);
    expect(b).toBe(0);
  });
});
