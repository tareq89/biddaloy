import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { authenticator } from 'otplib';
import { ApprovalScope, DEV_COCKPIT_TOTP_SECRET, UserStatus } from '@biddaloy/shared';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD } from '@test/constants';
import { User } from '../users/entities/user.entity';
import { PlatformAdmin } from './entities/platform-admin.entity';
import { hashPassword } from '../auth/password-hash';
import { MfaService } from '../auth/mfa/mfa.service';
import { PlatformHomeService } from './platform-home.service';
import { AccountAccessDeliveryService } from '../account-access/account-access-delivery.service';

/**
 * [Epic 98 #3756] Platform owners over real HTTP: step-up, lock and unlock, the lock race,
 * the two-owner approval flow, and the school-token wall. Every test makes its own owners
 * (unique suffix). Other owners in the database are suspended for the run so "last active
 * owner" and "two owners active" mean exactly the owners made here.
 */
describe('Platform identity E2E', () => {
  const COCKPIT = '/api/v1/auth/cockpit';
  const PLATFORM = '/api/v1/platform';
  const PASSWORD = 'Owner-pass-12345';
  const totp = authenticator.clone({ digits: 6, step: 30, window: 1 });

  let app: INestApplication;
  let ds: DataSource;
  let sentCodes: { kind: string; to: string; code?: string }[] = [];
  // Owners we suspended so the counts are ours; put back afterwards.
  let parked: string[] = [];

  interface Owner {
    id: string;
    email: string;
    phone: string;
    token: string;
  }

  // Listen on a real port: supertest closes an unbound server after each call, which breaks a
  // request built before an awaited step-up call.
  let baseUrl = '';
  const http = () => supertest(baseUrl);
  const codeSentTo = (to: string, kind: string) =>
    sentCodes.filter((s) => s.to === to && s.kind === kind).at(-1)?.code as string;

  /** A used authenticator step is refused; clearing it lets each call use the current code. */
  const freshStep = (userId: string) =>
    ds.query(`UPDATE user_mfa SET last_step = NULL WHERE user_id = $1`, [userId]);

  async function makeOwner(): Promise<Owner> {
    const suffix = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
    const email = `platform-e2e-${suffix}@biddaloy.test`;
    const phone = `+88017${suffix.slice(-9).padStart(9, '0')}`;
    const user = await ds.getRepository(User).save(
      ds.getRepository(User).create({
        email,
        phone,
        full_name: 'Platform e2e owner',
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
    // A new device is not trusted yet: both an SMS and an email code are needed.
    const done = await http()
      .post(`${COCKPIT}/device-otp`)
      .send({
        deviceToken: mfa.body.deviceToken,
        smsCode: codeSentTo(phone, 'COCKPIT_DEVICE_CODE'),
        emailCode: codeSentTo(email, 'COCKPIT_DEVICE_CODE'),
      })
      .expect(200);
    return { id: user.id, email, phone, token: done.body.access_token };
  }

  const auth = (o: Owner) => ({ Authorization: `Bearer ${o.token}` });

  async function stepUp(o: Owner, scope: ApprovalScope): Promise<string> {
    await freshStep(o.id);
    const res = await http()
      .post(`${PLATFORM}/step-up`)
      .set(auth(o))
      .send({ scope, code: totp.generate(DEV_COCKPIT_TOTP_SECRET) })
      .expect(200);
    return res.body.approval_token;
  }

  /** Suspends every platform owner except `keep`, so counts are exactly ours. */
  async function onlyActive(keep: string[]) {
    const rows: { user_id: string }[] = await ds.query(
      `SELECT pa.user_id FROM platform_admins pa JOIN users u ON u.id = pa.user_id
        WHERE u.status = 'ACTIVE' AND pa.user_id <> ALL($1::uuid[])`,
      [keep],
    );
    for (const r of rows) {
      await ds.query(`UPDATE users SET status = 'SUSPENDED' WHERE id = $1`, [r.user_id]);
      parked.push(r.user_id);
    }
  }

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
    // Step-up tokens are bound to the platform home school; the test DB may not have one yet.
    await app.get(PlatformHomeService).ensure();

    const delivery = app.get(AccountAccessDeliveryService);
    const real = delivery.deliver.bind(delivery);
    vi.spyOn(delivery, 'deliver').mockImplementation((input: any) => {
      sentCodes.push({ kind: input.kind, to: input.to, code: input.vars?.code });
      return real(input);
    });
  }, 60000);

  afterAll(async () => {
    for (const id of parked) {
      await ds.query(`UPDATE users SET status = 'ACTIVE' WHERE id = $1`, [id]);
    }
    await ds.query(`DELETE FROM platform_settings WHERE key = 'approvals.enabled'`);
    vi.restoreAllMocks();
    await app.close();
  });

  it('step-up gives a token for an owner, refuses a wrong code, a school scope and no bearer', async () => {
    const a = await makeOwner();
    const token = await stepUp(a, ApprovalScope.PLATFORM_OWNER_LOCK);
    expect(token).toEqual(expect.any(String));

    await freshStep(a.id);
    await http()
      .post(`${PLATFORM}/step-up`)
      .set(auth(a))
      .send({ scope: ApprovalScope.PLATFORM_OWNER_LOCK, code: '000000' })
      .expect(401);
    // A school scope is refused before the code is looked at.
    await http()
      .post(`${PLATFORM}/step-up`)
      .set(auth(a))
      .send({ scope: ApprovalScope.RESULTS_REOPEN, code: totp.generate(DEV_COCKPIT_TOTP_SECRET) })
      .expect(401);
    await http()
      .post(`${PLATFORM}/step-up`)
      .send({ scope: ApprovalScope.PLATFORM_OWNER_LOCK, code: '123456' })
      .expect(401);
  }, 60000);

  it('keeps school tokens out of every platform-identity route', async () => {
    const school = await http()
      .post('/api/v1/auth/login')
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    const bearer = { Authorization: `Bearer ${school.body.access_token}` };
    await http().get(`${PLATFORM}/owners`).set(bearer).expect(401);
    await http().get(`${PLATFORM}/owners/history`).set(bearer).expect(401);
    await http().get(`${PLATFORM}/approvals`).set(bearer).expect(401);
    await http().get(`${PLATFORM}/settings/approvals`).set(bearer).expect(401);
    await http().post(`${PLATFORM}/step-up`).set(bearer).send({}).expect(401);
  }, 30000);

  it('lists owners with masked contacts and a history page', async () => {
    const a = await makeOwner();
    const list = await http().get(`${PLATFORM}/owners`).set(auth(a)).expect(200);
    const me = list.body.find((o: { userId: string }) => o.userId === a.id);
    expect(me.email).not.toBe(a.email); // masked
    expect(me.status).toBe('ACTIVE');
    expect(list.headers['cache-control']).toContain('no-store');
    await http().get(`${PLATFORM}/owners/history?limit=5`).set(auth(a)).expect(200);
  }, 30000);

  it('lock needs a step-up token, then locks and unlocks the other owner', async () => {
    const a = await makeOwner();
    const b = await makeOwner();
    await onlyActive([a.id, b.id]);

    // No token: refused, nothing changes.
    await http().post(`${PLATFORM}/owners/${b.id}/lock`).set(auth(a)).expect(403);

    await http()
      .post(`${PLATFORM}/owners/${b.id}/lock`)
      .set(auth(a))
      .set('X-Approval-Token', await stepUp(a, ApprovalScope.PLATFORM_OWNER_LOCK))
      .expect(204);
    // Locked owner's bearer stops working at once (Rule 8).
    await http().get(`${PLATFORM}/owners`).set(auth(b)).expect(401);

    await http()
      .post(`${PLATFORM}/owners/${b.id}/unlock`)
      .set(auth(a))
      .set('X-Approval-Token', await stepUp(a, ApprovalScope.PLATFORM_OWNER_UNLOCK))
      .expect(204);
    const list = await http().get(`${PLATFORM}/owners`).set(auth(a)).expect(200);
    expect(list.body.find((o: { userId: string }) => o.userId === b.id).status).toBe('ACTIVE');
  }, 90000);

  it('refuses to lock yourself and a non-UUID id', async () => {
    const a = await makeOwner();
    const b = await makeOwner();
    await onlyActive([a.id, b.id]);
    const self = await http()
      .post(`${PLATFORM}/owners/${a.id}/lock`)
      .set(auth(a))
      .set('X-Approval-Token', await stepUp(a, ApprovalScope.PLATFORM_OWNER_LOCK));
    expect(self.status).toBe(409);
    expect(JSON.stringify(self.body)).toContain('CANNOT_LOCK_SELF');

    await http()
      .post(`${PLATFORM}/owners/not-a-uuid/lock`)
      .set(auth(a))
      .set('X-Approval-Token', await stepUp(a, ApprovalScope.PLATFORM_OWNER_LOCK))
      .expect(400);
  }, 90000);

  it('two owners locking each other at once: exactly one lock lands', async () => {
    const a = await makeOwner();
    const b = await makeOwner();
    await onlyActive([a.id, b.id]);
    const tokenA = await stepUp(a, ApprovalScope.PLATFORM_OWNER_LOCK);
    const tokenB = await stepUp(b, ApprovalScope.PLATFORM_OWNER_LOCK);

    const [ra, rb] = await Promise.all([
      http()
        .post(`${PLATFORM}/owners/${b.id}/lock`)
        .set(auth(a))
        .set('X-Approval-Token', tokenA),
      http()
        .post(`${PLATFORM}/owners/${a.id}/lock`)
        .set(auth(b))
        .set('X-Approval-Token', tokenB),
    ]);
    // One wins (204). The other is either refused as the last active owner (409) or already
    // locked out (401, its bearer was cut off by the winner).
    expect([ra.status, rb.status].filter((s) => s === 204)).toHaveLength(1);
    const rows: { status: string }[] = await ds.query(
      `SELECT status FROM users WHERE id = ANY($1::uuid[])`,
      [[a.id, b.id]],
    );
    expect(rows.filter((r) => r.status === 'ACTIVE')).toHaveLength(1);
  }, 90000);

  it('two-owner approval: ask, other owner approves, switch OFF lands once', async () => {
    const a = await makeOwner();
    const b = await makeOwner();
    await onlyActive([a.id, b.id]);
    const body = { enabled: false };

    // Switch is ON by default: turning it OFF files a request instead of acting.
    const asked = await http()
      .patch(`${PLATFORM}/settings/approvals`)
      .set(auth(a))
      .set('X-Approval-Token', await stepUp(a, ApprovalScope.PLATFORM_APPROVALS_SWITCH))
      .send(body);
    expect(asked.status).toBe(403);
    expect(JSON.stringify(asked.body)).toContain('APPROVAL_REQUESTED');
    const requestId: string = JSON.stringify(asked.body).match(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/,
    )![0];

    const pending = await http().get(`${PLATFORM}/approvals?status=PENDING`).set(auth(b)).expect(200);
    expect(pending.body.some((r: { id: string }) => r.id === requestId)).toBe(true);

    // The requester cannot approve their own request.
    await http()
      .post(`${PLATFORM}/approvals/${requestId}/approve`)
      .set(auth(a))
      .set('X-Approval-Token', await stepUp(a, ApprovalScope.PLATFORM_APPROVAL_DECIDE))
      .expect(409);

    await http()
      .post(`${PLATFORM}/approvals/${requestId}/approve`)
      .set(auth(b))
      .set('X-Approval-Token', await stepUp(b, ApprovalScope.PLATFORM_APPROVAL_DECIDE))
      .expect(204);

    // The grant works once, for the same body only.
    await http()
      .patch(`${PLATFORM}/settings/approvals`)
      .set(auth(a))
      .set('X-Approval-Token', await stepUp(a, ApprovalScope.PLATFORM_APPROVALS_SWITCH))
      .set('X-Platform-Approval', requestId)
      .send(body)
      .expect(200);
    // The grant was claimed exactly once: its row is USED. (Sending the same PATCH again would
    // need no second owner, because the switch is now OFF; that is the product rule.)
    const [grant] = await ds.query(`SELECT status FROM platform_approvals WHERE id = $1`, [
      requestId,
    ]);
    expect(grant.status).toBe('USED');

    // Switch is OFF now: the lock/other routes no longer need a second owner; turning ON is direct.
    const state = await http().get(`${PLATFORM}/settings/approvals`).set(auth(a)).expect(200);
    expect(state.body.enabled).toBe(false);
    await http()
      .patch(`${PLATFORM}/settings/approvals`)
      .set(auth(a))
      .set('X-Approval-Token', await stepUp(a, ApprovalScope.PLATFORM_APPROVALS_SWITCH))
      .send({ enabled: true })
      .expect(200);
  }, 120000);
});
