import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import supertest = require('supertest');
import { createHash, randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { authenticator } from 'otplib';
import type Redis from 'ioredis';
import {
  ApprovalScope,
  DEV_COCKPIT_TOTP_SECRET,
  ImpersonationEndedBy,
  ImpersonationEntryKind,
  SupportAccessMode,
  UserRole,
  UserStatus,
} from '@biddaloy/shared';
import { AppModule } from './app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from './validation-pipe';
import { User } from './modules/users/entities/user.entity';
import { UserTenant } from './modules/auth/entities/user-tenant.entity';
import { School } from './modules/schools/entities/school.entity';
import { PlatformAdmin } from './modules/platform-identity/entities/platform-admin.entity';
import { hashPassword } from './modules/auth/password-hash';
import { MfaService } from './modules/auth/mfa/mfa.service';
import { PlatformHomeService } from './modules/platform-identity/platform-home.service';
import { AccountAccessDeliveryService } from './modules/account-access/account-access-delivery.service';
import { TenantStatusService } from './modules/schools/tenant-status.service';
import { ImpersonationSessionService } from './modules/support-access/sessions/impersonation-session.service';
import { ImpersonationCodeService } from './modules/support-access/exchange/impersonation-code.service';
import {
  IMPERSONATION_REDIS,
  codeKey,
  impKey,
  rateKey,
} from './modules/support-access/sessions/impersonation-redis';
import { lockKey } from './modules/workbook/restore/restore-lock';

/**
 * [99.6.01] Epic 99 API fence over real HTTP: an imp token never leaves its school, every denied
 * route is refused, audit rows carry both ids, and each school state behaves as designed.
 * Wrong-school answers are the existing context-guard 401 (not 403): the same as any wrong tenant.
 * No code, token or secret is logged here: assertion messages carry status and ids only.
 */
describe('Login as fence (e2e)', () => {
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
  let adminC: { user: User; token: string };
  const parked: string[] = [];
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const sfx = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const asTenant = (t: string, schoolId: string) => ({ ...bearer(t), 'X-Tenant-ID': schoolId });

  async function makeOwner() {
    const s = sfx();
    const email = `fence-e2e-${s}@biddaloy.test`;
    const phone = `+88017${s.slice(-9).padStart(9, '0')}`;
    const user = await ds.getRepository(User).save(
      ds.getRepository(User).create({
        email,
        phone,
        full_name: 'Fence e2e owner',
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

  async function makeAdmin(school: School, label: string) {
    const s = randomUUID().slice(0, 8);
    const email = `fence-${label}-${s}@biddaloy.test`;
    const user = await ds.getRepository(User).save(
      ds.getRepository(User).create({
        email,
        full_name: `Fence ${label}`,
        status: UserStatus.ACTIVE,
        password_hash: await hashPassword(PASSWORD),
        email_verified_at: new Date(),
      }),
    );
    await ds
      .getRepository(UserTenant)
      .save({ user_id: user.id, tenant_id: school.id, role: UserRole.ADMIN });
    const login = await http()
      .post(`${API}/auth/login`)
      .send({ email, password: PASSWORD })
      .expect(200);
    return { user, token: login.body.access_token as string };
  }

  async function makeSchool(label: string): Promise<School> {
    const s = randomUUID().slice(0, 8);
    return ds
      .getRepository(School)
      .save(ds.getRepository(School).create({ name: `${label} ${s}`, slug: `fe-${s}` }));
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

  /** Ends every live session of the owner and clears the start counter: each case starts clean. */
  async function reset() {
    const sessions = app.get(ImpersonationSessionService);
    for (const s of await sessions.listLive()) {
      await sessions.end(s.id, ImpersonationEndedBy.OWNER);
    }
    await redis.del(rateKey(owner.id));
  }

  /** A live NORMAL session for `person` in school A; returns the one-time code and the exchanged token. */
  async function startAndExchange(person: User = adminA.user, viewOnly = false) {
    await reset();
    await setMode(schoolA.id, SupportAccessMode.ALLOWED);
    const row = await app.get(ImpersonationSessionService).create({
      platformAdminId: owner.id,
      schoolId: schoolA.id,
      targetUserId: person.id,
      role: UserRole.ADMIN,
      reason: 'Helping with a calendar problem',
      viewOnly,
      entryKind: ImpersonationEntryKind.NORMAL,
    });
    const code = await app.get(ImpersonationCodeService).issue(row.id);
    const res = await http().post(`${API}/auth/impersonation/exchange`).send({ code }).expect(200);
    return { sid: row.id, code, token: res.body.access_token as string };
  }

  /**
   * A fresh step-up token per start: the route spends one each time. `/platform/step-up` is
   * limited to 5 requests per 60 s, but the throttler skips itself under NODE_ENV=test
   * (`app.module.ts` `skipIf`), so six calls in a row are fine here.
   */
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
  async function ownerPost(path: string, body: Record<string, unknown>, status: number) {
    const res = await http()
      .post(`${API}${path}`)
      .set(bearer(owner.token))
      .set('X-Approval-Token', await stepUp())
      .send(body);
    expect(res.status, `${path}: ${res.status}`).toBe(status);
    return res;
  }
  const startBody = (over: Record<string, unknown> = {}) => ({
    schoolId: schoolA.id,
    role: UserRole.ADMIN,
    targetUserId: adminA.user.id,
    reason: 'Helping with a calendar problem',
    viewOnly: false,
    ...over,
  });
  const exchange = async (code: string) =>
    (await http().post(`${API}/auth/impersonation/exchange`).send({ code }).expect(200)).body
      .access_token as string;

  const eventBody = () => ({
    type: 'EVENT',
    name: `Fence ${randomUUID().slice(0, 6)}`,
    start_date: '2031-03-10',
    end_date: '2031-03-10',
  });
  const read = (t: string) => http().get(`${API}/calendar/events`).set(asTenant(t, schoolA.id));
  const write = (t: string) =>
    http().post(`${API}/calendar/events`).set(asTenant(t, schoolA.id)).send(eventBody());

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
    // Count only our owner: suspended others are put back in afterAll (emergency needs one owner).
    const others: { user_id: string }[] = await ds.query(
      `SELECT pa.user_id FROM platform_admins pa JOIN users u ON u.id = pa.user_id
        WHERE u.status = 'ACTIVE' AND pa.user_id <> $1`,
      [owner.id],
    );
    for (const r of others) {
      await ds.query(`UPDATE users SET status = 'SUSPENDED' WHERE id = $1`, [r.user_id]);
      parked.push(r.user_id);
    }
    schoolA = await makeSchool('Fence A');
    schoolB = await makeSchool('Fence B');
    adminA = await makeAdmin(schoolA, 'adminA');
    adminC = await makeAdmin(schoolA, 'adminC');
    adminB = await makeAdmin(schoolB, 'adminB');
    await ds.query(
      `INSERT INTO academic_years (name, start_date, end_date, is_current, tenant_id)
       VALUES ('2031', '2031-01-01', '2031-12-31', false, $1)`,
      [schoolA.id],
    );
  }, 120000);

  afterEach(async () => {
    // Put school A back whatever a case did to it.
    await ds.query(`UPDATE schools SET status = 'ACTIVE' WHERE id = $1`, [schoolA.id]);
    await redis.del(lockKey(schoolA.id));
    await app.get(TenantStatusService).invalidate(schoolA.id);
  });

  afterAll(async () => {
    const live: { id: string }[] = await ds.query(
      `SELECT id FROM impersonation_sessions WHERE platform_admin_id = $1`,
      [owner.id],
    );
    if (live.length) await redis.del(...live.map((s) => impKey(s.id)));
    await ds.query(`DELETE FROM impersonation_sessions WHERE platform_admin_id = $1`, [owner.id]);
    for (const id of parked)
      await ds.query(`UPDATE users SET status = 'ACTIVE' WHERE id = $1`, [id]);
    vi.restoreAllMocks();
    await app.close();
  });

  it('(1) an imp token for school A on school B routes is the wrong-tenant 401', async () => {
    const { token } = await startAndExchange();
    await read(token).expect(200);
    // The same answer the person's normal token gets for a school it does not belong to.
    const imp = await http().get(`${API}/calendar/events`).set(asTenant(token, schoolB.id));
    const normal = await http()
      .get(`${API}/calendar/events`)
      .set(asTenant(adminA.token, schoolB.id));
    expect(imp.status).toBe(401);
    expect(normal.status).toBe(401);
    expect(imp.body).toEqual(normal.body);
  }, 60000);

  it('(2) missing and invalid X-Tenant-ID with an imp token are 401', async () => {
    const { token } = await startAndExchange();
    await http().get(`${API}/calendar/events`).set(bearer(token)).expect(401);
    await http().get(`${API}/calendar/events`).set(asTenant(token, 'not-a-uuid')).expect(401);
    await http().get(`${API}/calendar/events`).set(asTenant(token, randomUUID())).expect(401);
  }, 60000);

  it('(3) every deny-list route is 403 for imp and not denied for the normal token', async () => {
    const lines = readFileSync(join(__dirname, 'impersonation-deny-list.snapshot.txt'), 'utf8')
      .split('\n')
      .filter((l) => l && !l.startsWith('#'));
    expect(lines.length).toBeGreaterThan(20);
    const { token } = await startAndExchange(adminC.user);
    const denied: string[] = [];
    const wronglyBlocked: string[] = [];
    const parsed = lines.map((line) => {
      const [method, rawPath, keys] = line.split(' ');
      const path = rawPath.replace(/:[a-zA-Z]+/g, () => randomUUID());
      const body: Record<string, unknown> = {};
      for (const k of keys ? keys.replace('bodyKeys=', '').split(',') : []) body[k] = 'x';
      return { line, method: method.toLowerCase(), path, body };
    });
    const call = (r: (typeof parsed)[number], t: string) =>
      (http() as any)[r.method](`${API}${r.path}`).set(asTenant(t, schoolA.id)).send(r.body);
    for (const r of parsed) {
      const imp = await call(r, token);
      if (imp.status !== 403 || !JSON.stringify(imp.body).includes('IMPERSONATION_DENIED'))
        denied.push(`${r.line} -> ${imp.status}`);
    }
    // The mark is the only reason for a refusal: the normal token never gets that code.
    // logout-all and change-password would cut adminC's own session: skipped here.
    for (const r of parsed.filter((x) => !/logout-all|change-password/.test(x.path))) {
      const normal = await call(r, adminC.token);
      if (JSON.stringify(normal.body).includes('IMPERSONATION_DENIED'))
        wronglyBlocked.push(`${r.line} -> ${normal.status}`);
    }
    expect(denied).toEqual([]);
    expect(wronglyBlocked).toEqual([]);
  }, 180000);

  it('(4) audit rows carry both ids and the person as performer', async () => {
    const { token, sid } = await startAndExchange();
    await write(token).expect(201);
    const rows = await ds.query(
      `SELECT impersonated_by_platform_admin_id AS pa, impersonation_session_id AS sid, performed_by_user_id AS who
         FROM audit_logs WHERE impersonation_session_id = $1 AND entity_type = 'CalendarEvent'`,
      [sid],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ pa: owner.id, sid, who: adminA.user.id });
    // A write by the person's own token carries neither.
    await write(adminA.token).expect(201);
    const own = await ds.query(
      `SELECT 1 FROM audit_logs WHERE performed_by_user_id = $1 AND entity_type = 'CalendarEvent'
          AND impersonation_session_id IS NULL AND impersonated_by_platform_admin_id IS NULL`,
      [adminA.user.id],
    );
    expect(own.length).toBeGreaterThan(0);
  }, 60000);

  it('(5) blocked school: normal start refused, emergency is read-only (POST 403, GET 200)', async () => {
    await reset();
    await setMode(schoolA.id, SupportAccessMode.BLOCKED);
    const refused = await app
      .get(ImpersonationSessionService)
      .create({
        platformAdminId: owner.id,
        schoolId: schoolA.id,
        targetUserId: adminA.user.id,
        role: UserRole.ADMIN,
        reason: 'Helping with a calendar problem',
        viewOnly: false,
        entryKind: ImpersonationEntryKind.NORMAL,
      })
      .then(
        () => 'started',
        (e) => JSON.stringify(e.getResponse?.() ?? {}),
      );
    expect(refused).toContain('SUPPORT_ACCESS_BLOCKED');
    const res = await ownerPost('/platform/impersonation', startBody(), 201);
    expect(res.body.status).toBe('ACTIVE');
    const token = await exchange(res.body.code);
    await read(token).expect(200);
    const post = await write(token).expect(403);
    expect(JSON.stringify(post.body)).toContain('SUPPORT_VIEW_ONLY');
  }, 90000);

  it('(6) a school admin approving the write request turns the emergency session read-write', async () => {
    await reset();
    await setMode(schoolA.id, SupportAccessMode.BLOCKED);
    const start = await ownerPost('/platform/impersonation', startBody(), 201);
    const token = await exchange(start.body.code);
    await write(token).expect(403);
    await ownerPost(
      `/platform/impersonation/${start.body.id}/request-write`,
      { reason: 'Need to fix the calendar for the school' },
      204,
    );
    await http()
      .post(`${API}/support-access/requests/${start.body.id}/approve`)
      .set(asTenant(adminA.token, schoolA.id))
      .expect(200);
    await write(token).expect(201);
  }, 90000);

  it('(7) a suspended and a seat-grace school pass for imp; a restoring school refuses writes', async () => {
    const { token } = await startAndExchange();
    const status = app.get(TenantStatusService);

    // Suspended: the person is blocked, support is not.
    await ds.query(`UPDATE schools SET status = 'SUSPENDED' WHERE id = $1`, [schoolA.id]);
    await status.invalidate(schoolA.id);
    expect((await read(adminA.token)).status).toBe(403);
    await read(token).expect(200);
    await write(token).expect(201);
    await ds.query(`UPDATE schools SET status = 'ACTIVE' WHERE id = $1`, [schoolA.id]);
    await status.invalidate(schoolA.id);

    // Seat grace: read-only for the person, open for support. The window itself is faked
    // (a real one needs more active students than seats); the guard path is the real one.
    const grace = vi
      .spyOn(status, 'getReadOnlyUntil')
      .mockResolvedValue(new Date(Date.now() + 86_400_000));
    const person = await write(adminA.token);
    expect(person.status).toBe(403);
    expect(JSON.stringify(person.body)).toContain('TENANT_READ_ONLY');
    await write(token).expect(201);
    grace.mockRestore();

    // Restoring: writes are refused for support too, reads stay open.
    await redis.set(lockKey(schoolA.id), randomUUID(), 'EX', 60);
    await read(token).expect(200);
    const restoring = await write(token);
    expect(restoring.status, `restoring write: ${restoring.status}`).toBe(423);
  }, 90000);

  it('(8) deleting imp:<sid> makes the next call 401', async () => {
    const { token, sid } = await startAndExchange();
    await read(token).expect(200);
    await redis.del(impKey(sid));
    await read(token).expect(401);
  }, 60000);

  it('(9) the one-time code works once, then 401, and 401 after 60 s', async () => {
    const { code } = await startAndExchange();
    await http().post(`${API}/auth/impersonation/exchange`).send({ code }).expect(401);

    // A fresh code, aged out: the Redis expiry is the 60 s rule, forced to 50 ms here.
    const { sid } = await startAndExchange();
    const late = await app.get(ImpersonationCodeService).issue(sid);
    const key = codeKey(createHash('sha256').update(late).digest('hex'));
    const ttl = await redis.ttl(key);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60);
    await redis.pexpire(key, 50);
    await vi.waitFor(async () => expect(await redis.exists(key)).toBe(0));
    await http().post(`${API}/auth/impersonation/exchange`).send({ code: late }).expect(401);
  }, 60000);

  it('(10) an imp token on a cockpit route is refused', async () => {
    const { token } = await startAndExchange();
    await http().get(`${API}/platform/impersonation`).set(bearer(token)).expect(401);
    await http()
      .get(`${API}/platform/schools/${schoolA.id}/login-as/candidates?role=ADMIN`)
      .set(bearer(token))
      .expect(401);
  }, 60000);

  it('ask: REQUESTED, the other school cannot approve (404), the right admin can, ticket redeems once', async () => {
    await reset();
    await setMode(schoolA.id, SupportAccessMode.ASK);
    const res = await ownerPost('/platform/impersonation', startBody(), 201);
    expect(res.body.status).toBe('REQUESTED');
    expect(res.body.code).toBeUndefined();
    const id = res.body.id as string;
    await http()
      .post(`${API}/support-access/requests/${id}/approve`)
      .set(asTenant(adminB.token, schoolB.id))
      .expect(404);
    await http()
      .post(`${API}/support-access/requests/${id}/approve`)
      .set(asTenant(adminA.token, schoolA.id))
      .expect(200);
    const redeemed = await ownerPost('/platform/impersonation', startBody({ ticketId: id }), 201);
    expect(redeemed.body.status).toBe('ACTIVE');
    await ownerPost('/platform/impersonation', startBody({ ticketId: id }), 409);
  }, 90000);
});
