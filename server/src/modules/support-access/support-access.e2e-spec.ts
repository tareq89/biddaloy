import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { authenticator } from 'otplib';
import { randomUUID } from 'crypto';
import {
  DEV_COCKPIT_TOTP_SECRET,
  ImpersonationEntryKind,
  UserRole,
  UserStatus,
} from '@biddaloy/shared';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { User } from '../users/entities/user.entity';
import { UserTenant } from '../auth/entities/user-tenant.entity';
import { School } from '../schools/entities/school.entity';
import { PlatformAdmin } from '../platform-identity/entities/platform-admin.entity';
import { hashPassword } from '../auth/password-hash';
import { MfaService } from '../auth/mfa/mfa.service';
import { PlatformHomeService } from '../platform-identity/platform-home.service';
import { AccountAccessDeliveryService } from '../account-access/account-access-delivery.service';
import { ImpersonationSessionService } from './sessions/impersonation-session.service';
import { ImpersonationCodeService } from './exchange/impersonation-code.service';
import { IMPERSONATION_REDIS, impKey } from './sessions/impersonation-redis';
import type Redis from 'ioredis';

/**
 * [99.2.07] Login as over real HTTP, through the real JwtStrategy, ContextGuard and deny
 * interceptor: start a session with the service, swap the one-time code, then use the token.
 */
describe('Login as server core (e2e)', () => {
  const API = '/api/v1';
  const COCKPIT = `${API}/auth/cockpit`;
  const PASSWORD = 'Owner-pass-12345';
  const totp = authenticator.clone({ digits: 6, step: 30, window: 1 });

  let app: INestApplication;
  let ds: DataSource;
  let redis: Redis;
  let baseUrl = '';
  const http = () => supertest(baseUrl);
  let sent: { kind: string; to: string; code?: string }[] = [];
  const codeSentTo = (to: string, kind: string) =>
    sent.filter((s) => s.to === to && s.kind === kind).at(-1)?.code as string;

  let owner: { id: string; token: string };
  let schoolA: School;
  let schoolB: School;
  let adminA: User;

  async function makeOwner() {
    const sfx = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
    const email = `login-as-e2e-${sfx}@biddaloy.test`;
    const phone = `+88017${sfx.slice(-9).padStart(9, '0')}`;
    const user = await ds.getRepository(User).save(
      ds.getRepository(User).create({
        email,
        phone,
        full_name: 'Login as e2e owner',
        status: UserStatus.ACTIVE,
        password_hash: await hashPassword(PASSWORD),
        email_verified_at: new Date(),
        phone_verified_at: new Date(),
      }),
    );
    await ds.getRepository(PlatformAdmin).insert({ user_id: user.id });
    await app.get(MfaService).enrolWithKnownSecret(user.id, DEV_COCKPIT_TOTP_SECRET);
    const login = await http().post(`${COCKPIT}/login`).send({ email, password: PASSWORD });
    const mfa = await http()
      .post(`${COCKPIT}/mfa`)
      .send({ mfaToken: login.body.mfaToken, code: totp.generate(DEV_COCKPIT_TOTP_SECRET) })
      .expect(200);
    const done = await http()
      .post(`${COCKPIT}/device-otp`)
      .send({
        deviceToken: mfa.body.deviceToken,
        smsCode: codeSentTo(phone, 'COCKPIT_DEVICE_CODE'),
        emailCode: codeSentTo(email, 'COCKPIT_DEVICE_CODE'),
      })
      .expect(200);
    return { id: user.id, token: done.body.access_token as string };
  }

  async function makeSchool(label: string): Promise<School> {
    const sfx = randomUUID().slice(0, 8);
    const school = await ds
      .getRepository(School)
      .save(ds.getRepository(School).create({ name: `${label} ${sfx}`, slug: `la-${sfx}` }));
    // `allowed` makes a start go live at once (no ticket step).
    await ds.query(
      `UPDATE schools SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{supportAccess}', $2::jsonb) WHERE id = $1`,
      [school.id, JSON.stringify({ mode: 'allowed', confirmedAt: null, confirmedBy: null, textVersion: 0 })],
    );
    return school;
  }

  /** Starts a live session for `adminA` of school A and swaps its code for the imp token. */
  async function startAndExchange(viewOnly = false) {
    const row = await app.get(ImpersonationSessionService).create({
      platformAdminId: owner.id,
      schoolId: schoolA.id,
      targetUserId: adminA.id,
      role: UserRole.ADMIN,
      reason: 'Helping with a calendar problem',
      viewOnly,
      entryKind: ImpersonationEntryKind.NORMAL,
    });
    const code = await app.get(ImpersonationCodeService).issue(row.id);
    const res = await http().post(`${API}/auth/impersonation/exchange`).send({ code }).expect(200);
    return { sid: row.id, code, res, token: res.body.access_token as string };
  }

  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const eventBody = () => ({
    type: 'EVENT',
    name: `Login as ${randomUUID().slice(0, 6)}`,
    start_date: '2031-03-10',
    end_date: '2031-03-10',
  });

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.COCKPIT_DOMAIN = process.env.COCKPIT_DOMAIN ?? 'cockpit.biddaloy.test';
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.listen(0);
    baseUrl = await app.getUrl();
    ds = app.get(DataSource);
    redis = app.get(IMPERSONATION_REDIS);
    await app.get(PlatformHomeService).ensure();

    const delivery = app.get(AccountAccessDeliveryService);
    const real = delivery.deliver.bind(delivery);
    vi.spyOn(delivery, 'deliver').mockImplementation((input: any) => {
      sent.push({ kind: input.kind, to: input.to, code: input.vars?.code });
      return real(input);
    });

    owner = await makeOwner();
    schoolA = await makeSchool('Login as A');
    schoolB = await makeSchool('Login as B');
    adminA = await ds.getRepository(User).save(
      ds.getRepository(User).create({
        email: `la-admin-${randomUUID().slice(0, 8)}@biddaloy.test`,
        full_name: 'Login as school A admin',
        status: UserStatus.ACTIVE,
      }),
    );
    await ds
      .getRepository(UserTenant)
      .save({ user_id: adminA.id, tenant_id: schoolA.id, role: UserRole.ADMIN });
    // A calendar event needs an academic year that holds its date.
    await ds.query(
      `INSERT INTO academic_years (name, start_date, end_date, is_current, tenant_id)
       VALUES ('2031', '2031-01-01', '2031-12-31', false, $1)`,
      [schoolA.id],
    );
  }, 90000);

  afterAll(async () => {
    // The per-file test setup deletes platform_admins; a session row would block that (RESTRICT FK).
    const live: { id: string }[] = await ds.query(
      `SELECT id FROM impersonation_sessions WHERE platform_admin_id = $1`,
      [owner.id],
    );
    await redis.del(...live.map((s) => impKey(s.id)));
    await ds.query(`DELETE FROM impersonation_sessions WHERE platform_admin_id = $1`, [owner.id]);
    vi.restoreAllMocks();
    await app.close();
  });

  it('(1) the token reads school A, and school B in X-Tenant-ID is 401', async () => {
    const { token } = await startAndExchange();
    await http()
      .get(`${API}/calendar/events`)
      .set(bearer(token))
      .set('X-Tenant-ID', schoolA.id)
      .expect(200);
    // The person has no membership in B: the existing context-guard answer is 401.
    await http()
      .get(`${API}/calendar/events`)
      .set(bearer(token))
      .set('X-Tenant-ID', schoolB.id)
      .expect(401);
    // Missing and invalid headers keep the existing answers.
    await http().get(`${API}/calendar/events`).set(bearer(token)).expect(401);
    await http()
      .get(`${API}/calendar/events`)
      .set(bearer(token))
      .set('X-Tenant-ID', 'not-a-uuid')
      .expect(401);
  }, 60000);

  it('(2) POST /auth/change-password is 403 IMPERSONATION_DENIED', async () => {
    const { token } = await startAndExchange();
    const res = await http()
      .post(`${API}/auth/change-password`)
      .set(bearer(token))
      .send({ currentPassword: 'x', newPassword: 'Another-pass-12345' })
      .expect(403);
    // The denial must come from the deny interceptor, not another 403.
    expect(res.body.code ?? res.body.error?.code ?? JSON.stringify(res.body)).toContain(
      'IMPERSONATION_DENIED',
    );
  }, 60000);

  it('(3) an allowed write leaves an audit row with both ids set', async () => {
    const { token, sid } = await startAndExchange();
    await http()
      .post(`${API}/calendar/events`)
      .set(bearer(token))
      .set('X-Tenant-ID', schoolA.id)
      .send(eventBody())
      .expect(201);
    const rows = await ds.query(
      `SELECT impersonated_by_platform_admin_id AS pa, impersonation_session_id AS sid, performed_by_user_id AS who
         FROM audit_logs WHERE impersonation_session_id = $1 AND entity_type = 'CalendarEvent'`,
      [sid],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ pa: owner.id, sid, who: adminA.id });
  }, 60000);

  it('(4) deleting imp:<sid> makes the next call 401', async () => {
    const { token, sid } = await startAndExchange();
    const ok = () =>
      http().get(`${API}/calendar/events`).set(bearer(token)).set('X-Tenant-ID', schoolA.id);
    await ok().expect(200);
    await redis.del(impKey(sid));
    await ok().expect(401);
  }, 60000);

  it('(5) the same token on a /platform/* route is 401', async () => {
    const { token } = await startAndExchange();
    await http().get(`${API}/platform/impersonation`).set(bearer(token)).expect(401);
    await http()
      .get(`${API}/platform/schools/${schoolA.id}/login-as/candidates?role=ADMIN`)
      .set(bearer(token))
      .expect(401);
  }, 60000);

  it('(6) a cockpit token on a school route is 401', async () => {
    await http()
      .get(`${API}/calendar/events`)
      .set(bearer(owner.token))
      .set('X-Tenant-ID', schoolA.id)
      .expect(401);
    // And on the Login as bearer routes, which take the app audience only.
    await http().get(`${API}/auth/impersonation/me`).set(bearer(owner.token)).expect(401);
  }, 60000);

  it('exchange answers no-store, and the code works once', async () => {
    const { code, res } = await startAndExchange();
    expect(res.headers['cache-control']).toContain('no-store');
    await http().post(`${API}/auth/impersonation/exchange`).send({ code }).expect(401);
  }, 60000);

  it('me and end work for the live token; after end the same token is 401 on both', async () => {
    const { token, sid } = await startAndExchange();
    const me = await http().get(`${API}/auth/impersonation/me`).set(bearer(token)).expect(200);
    expect(me.body).toBeTruthy();
    await http().post(`${API}/auth/impersonation/end`).set(bearer(token)).expect(204);
    expect(await redis.exists(impKey(sid))).toBe(0);
    await http().get(`${API}/auth/impersonation/me`).set(bearer(token)).expect(401);
    await http().post(`${API}/auth/impersonation/end`).set(bearer(token)).expect(401);
  }, 60000);

  it('me and end with no bearer are 401', async () => {
    await http().get(`${API}/auth/impersonation/me`).expect(401);
    await http().post(`${API}/auth/impersonation/end`).expect(401);
  }, 30000);
});
