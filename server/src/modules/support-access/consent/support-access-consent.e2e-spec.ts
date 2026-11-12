import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { authenticator } from 'otplib';
import { randomUUID } from 'crypto';
import {
  ApprovalScope,
  DEV_COCKPIT_TOTP_SECRET,
  SupportAccessMode,
  UserRole,
  UserStatus,
} from '@biddaloy/shared';
import { AppModule } from '../../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../../validation-pipe';
import { User } from '../../users/entities/user.entity';
import { UserTenant } from '../../auth/entities/user-tenant.entity';
import { School } from '../../schools/entities/school.entity';
import { PlatformAdmin } from '../../platform-identity/entities/platform-admin.entity';
import { hashPassword } from '../../auth/password-hash';
import { MfaService } from '../../auth/mfa/mfa.service';
import { PlatformHomeService } from '../../platform-identity/platform-home.service';
import { AccountAccessDeliveryService } from '../../account-access/account-access-delivery.service';
import { IMPERSONATION_REDIS, impKey } from '../sessions/impersonation-redis';
import type Redis from 'ioredis';

/**
 * [99.3.close] The consent modes end to end over real HTTP: owner start (cockpit token) in
 * allowed / ask / blocked, the school admin's settings, confirm and request routes, and the
 * cross-school and header rules every school route keeps.
 */
describe('Support access consent modes (e2e)', () => {
  const API = '/api/v1';
  const COCKPIT = `${API}/auth/cockpit`;
  const PASSWORD = 'Owner-pass-12345';
  const totp = authenticator.clone({ digits: 6, step: 30, window: 1 });

  let app: INestApplication;
  let ds: DataSource;
  let redis: Redis;
  let baseUrl = '';
  const http = () => supertest(baseUrl);
  const sent: { kind: string; to: string; code?: string }[] = [];
  const codeSentTo = (to: string, kind: string) =>
    sent.filter((s) => s.to === to && s.kind === kind).at(-1)?.code as string;

  let owner: { id: string; token: string };
  let schoolA: School;
  let schoolB: School;
  let adminA: { user: User; token: string };
  let adminB: { user: User; token: string };
  const extraOwners: string[] = [];
  const parked: string[] = [];

  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const sfx = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`;

  async function makeOwner() {
    const s = sfx();
    const email = `consent-e2e-${s}@biddaloy.test`;
    const phone = `+88017${s.slice(-9).padStart(9, '0')}`;
    const user = await ds.getRepository(User).save(
      ds.getRepository(User).create({
        email,
        phone,
        full_name: 'Consent e2e owner',
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

  async function makeSchoolWithAdmin(label: string) {
    const s = randomUUID().slice(0, 8);
    const school = await ds
      .getRepository(School)
      .save(ds.getRepository(School).create({ name: `${label} ${s}`, slug: `sc-${s}` }));
    const email = `consent-admin-${s}@biddaloy.test`;
    const user = await ds.getRepository(User).save(
      ds.getRepository(User).create({
        email,
        full_name: `${label} admin`,
        status: UserStatus.ACTIVE,
        password_hash: await hashPassword(PASSWORD),
        email_verified_at: new Date(),
      }),
    );
    await ds
      .getRepository(UserTenant)
      .save({ user_id: user.id, tenant_id: school.id, role: UserRole.ADMIN });
    const login = await http().post(`${API}/auth/login`).send({ email, password: PASSWORD });
    return { school, admin: { user, token: login.body.access_token as string } };
  }

  /** Confirmed at the current text version, so the mode is in force. */
  const setMode = (schoolId: string, mode: SupportAccessMode) =>
    ds.query(
      `UPDATE schools SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{supportAccess}', $2::jsonb) WHERE id = $1`,
      [
        schoolId,
        JSON.stringify({
          mode,
          confirmedAt: new Date().toISOString(),
          confirmedBy: null,
          textVersion: 99,
        }),
      ],
    );

  const startBody = (over: Record<string, unknown> = {}) => ({
    schoolId: schoolA.id,
    role: UserRole.ADMIN,
    targetUserId: adminA.user.id,
    reason: 'Helping with a calendar problem',
    viewOnly: false,
    ...over,
  });
  /** A fresh step-up token per start: the route spends one each time. */
  async function stepUp(): Promise<string> {
    await ds.query(`UPDATE user_mfa SET last_step = NULL WHERE user_id = $1`, [owner.id]);
    const res = await http()
      .post(`${API}/platform/step-up`)
      .set(bearer(owner.token))
      .send({
        scope: ApprovalScope.PLATFORM_LOGIN_AS,
        code: totp.generate(DEV_COCKPIT_TOTP_SECRET),
      })
      .expect(200);
    return res.body.approval_token;
  }
  const rawStart = async (body: Record<string, unknown>) =>
    http()
      .post(`${API}/platform/impersonation`)
      .set(bearer(owner.token))
      .set('X-Approval-Token', await stepUp())
      .send(body);
  /** `start(body).expect(code)` resolves to the response once the status matches. */
  const start = (body: Record<string, unknown>) => ({
    expect: async (code: number) => {
      const res = await rawStart(body);
      expect(res.status, JSON.stringify(res.body)).toBe(code);
      return res;
    },
  });
  const asAdmin = (a: { token: string }, schoolId: string) => ({
    ...bearer(a.token),
    'X-Tenant-ID': schoolId,
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
    // Count only our owner(s): suspended others are put back in afterAll.
    const others: { user_id: string }[] = await ds.query(
      `SELECT pa.user_id FROM platform_admins pa JOIN users u ON u.id = pa.user_id
        WHERE u.status = 'ACTIVE' AND pa.user_id <> $1`,
      [owner.id],
    );
    for (const r of others) {
      await ds.query(`UPDATE users SET status = 'SUSPENDED' WHERE id = $1`, [r.user_id]);
      parked.push(r.user_id);
    }
    const a = await makeSchoolWithAdmin('Consent A');
    const b = await makeSchoolWithAdmin('Consent B');
    schoolA = a.school;
    adminA = a.admin;
    schoolB = b.school;
    adminB = b.admin;
  }, 120000);

  afterAll(async () => {
    const owners = [owner.id, ...extraOwners];
    const live: { id: string }[] = await ds.query(
      `SELECT id FROM impersonation_sessions WHERE platform_admin_id = ANY($1)`,
      [owners],
    );
    if (live.length) await redis.del(...live.map((s) => impKey(s.id)));
    await ds.query(`DELETE FROM impersonation_sessions WHERE platform_admin_id = ANY($1)`, [
      owners,
    ]);
    for (const id of parked)
      await ds.query(`UPDATE users SET status = 'ACTIVE' WHERE id = $1`, [id]);
    vi.restoreAllMocks();
    await app.close();
  });

  it('allowed: a start is ACTIVE with a code, and the admins are emailed', async () => {
    await setMode(schoolA.id, SupportAccessMode.ALLOWED);
    const res = await start(startBody()).expect(201);
    expect(res.body.status).toBe('ACTIVE');
    expect(res.body.code).toBeTruthy();
    // The admins' notice is logged by AdminNoticeService, one row per admin e-mail.
    const rows = await ds.query(
      `SELECT 1 FROM communication_logs WHERE tenant_id = $1 AND recipient_address = $2 AND metadata->>'kind' = 'support_session_started'`,
      [schoolA.id, adminA.user.email],
    );
    expect(rows).toHaveLength(1);
  }, 60000);

  it('ask: REQUESTED, admin approves, owner redeems the ticket once', async () => {
    await setMode(schoolA.id, SupportAccessMode.ASK);
    const res = await start(startBody()).expect(201);
    expect(res.body.status).toBe('REQUESTED');
    expect(res.body.code).toBeUndefined();
    const id = res.body.id as string;

    const list = await http()
      .get(`${API}/support-access/requests`)
      .set(asAdmin(adminA, schoolA.id))
      .expect(200);
    expect(JSON.stringify(list.body)).toContain(id);

    await http()
      .post(`${API}/support-access/requests/${id}/approve`)
      .set(asAdmin(adminA, schoolA.id))
      .expect(200);

    const redeemed = await start(startBody({ ticketId: id })).expect(201);
    expect(redeemed.body.status).toBe('ACTIVE');
    expect(redeemed.body.code).toBeTruthy();
    const again = await start(startBody({ ticketId: id })).expect(409);
    expect(JSON.stringify(again.body)).toContain('TICKET_NOT_USABLE');
    // The redeemed code swaps for a working token once.
    await http()
      .post(`${API}/auth/impersonation/exchange`)
      .send({ code: redeemed.body.code })
      .expect(200);
  }, 60000);

  it('ask: a denied request cannot be redeemed', async () => {
    await setMode(schoolA.id, SupportAccessMode.ASK);
    const { body } = await start(startBody()).expect(201);
    await http()
      .post(`${API}/support-access/requests/${body.id}/deny`)
      .set(asAdmin(adminA, schoolA.id))
      .expect(200);
    await start(startBody({ ticketId: body.id })).expect(409);
  }, 60000);

  it('blocked: no reason is 400, a reason starts an emergency session', async () => {
    await setMode(schoolA.id, SupportAccessMode.BLOCKED);
    const { reason: _reason, ...noReason } = startBody();
    await start(noReason).expect(400);
    const res = await start(startBody()).expect(201);
    expect(res.body.status).toBe('ACTIVE');
  }, 60000);

  it('switching to blocked ends a live session: its token is 401 next request', async () => {
    await setMode(schoolA.id, SupportAccessMode.ALLOWED);
    const res = await start(startBody()).expect(201);
    const ex = await http()
      .post(`${API}/auth/impersonation/exchange`)
      .send({ code: res.body.code })
      .expect(200);
    const me = () => http().get(`${API}/auth/impersonation/me`).set(bearer(ex.body.access_token));
    await me().expect(200);
    await http()
      .put(`${API}/support-access/settings`)
      .set(asAdmin(adminA, schoolA.id))
      .send({ mode: 'blocked' })
      .expect(200);
    await me().expect(401);
  }, 60000);

  it('confirm with a stale text version is 409 TEXT_VERSION_STALE', async () => {
    const res = await http()
      .post(`${API}/support-access/confirm`)
      .set(asAdmin(adminA, schoolA.id))
      .send({ allowed: true, textVersion: 0 })
      .expect(409);
    expect(JSON.stringify(res.body)).toContain('TEXT_VERSION_STALE');
  }, 30000);

  const schoolRoutes: [string, string][] = [
    ['get', '/support-access/settings'],
    ['put', '/support-access/settings'],
    ['post', '/support-access/confirm'],
    ['get', '/support-access/requests'],
    ['post', `/support-access/requests/${randomUUID()}/approve`],
    ['post', `/support-access/requests/${randomUUID()}/deny`],
    ['get', '/support-access/sessions'],
    ['get', '/support-access/platform-actions'],
    ['post', `/support-access/sessions/${randomUUID()}/end`],
  ];
  it.each(schoolRoutes)(
    '%s %s: missing or invalid X-Tenant-ID is 401',
    async (method, path) => {
      const call = () => (http() as any)[method](`${API}${path}`).set(bearer(adminA.token));
      await call().expect(401);
      await call().set('X-Tenant-ID', 'not-a-uuid').expect(401);
    },
    30000,
  );

  it("an admin of school B cannot see or decide school A's requests", async () => {
    await setMode(schoolA.id, SupportAccessMode.ASK);
    const { body } = await start(startBody()).expect(201);
    const listB = await http()
      .get(`${API}/support-access/requests`)
      .set(asAdmin(adminB, schoolB.id))
      .expect(200);
    expect(JSON.stringify(listB.body)).not.toContain(body.id);
    // A's admin token with B's tenant header: no membership there.
    await http().get(`${API}/support-access/requests`).set(asAdmin(adminA, schoolB.id)).expect(401);
    await http()
      .post(`${API}/support-access/requests/${body.id}/approve`)
      .set(asAdmin(adminB, schoolB.id))
      .expect(404);
  }, 60000);

  it('blocked with two owners: the start answers APPROVAL_REQUESTED', async () => {
    const second = await makeOwner();
    extraOwners.push(second.id);
    await setMode(schoolA.id, SupportAccessMode.BLOCKED);
    try {
      const res = await start(startBody()).expect(403);
      expect(JSON.stringify(res.body)).toContain('APPROVAL_REQUESTED');
    } finally {
      // Back to one owner, so the single-owner default holds for whatever runs next in this DB.
      await ds.query(`DELETE FROM platform_approvals WHERE requested_by = ANY($1)`, [
        [owner.id, second.id],
      ]);
      await ds.query(`DELETE FROM platform_admins WHERE user_id = $1`, [second.id]);
    }
  }, 90000);
});
