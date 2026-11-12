import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { authenticator } from 'otplib';
import { ApprovalScope, DEV_COCKPIT_TOTP_SECRET, UserRole, UserStatus } from '@biddaloy/shared';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD, SEED_ADMIN_PASSWORD_HASH } from '@test/constants';
import { User } from '../users/entities/user.entity';
import { PlatformAdmin } from '../platform-identity/entities/platform-admin.entity';
import { hashPassword } from '../auth/password-hash';
import { MfaService } from '../auth/mfa/mfa.service';
import { PlatformHomeService } from '../platform-identity/platform-home.service';
import { AccountAccessDeliveryService } from '../account-access/account-access-delivery.service';
import { lockKey } from '../workbook/restore/restore-lock';
import { BULK_IMPORT_REDIS } from '../bulk-import/import-staging.service';

/**
 * [Epic 99 #3816] The wired Wave 4 cockpit surface over real HTTP: the wall (a school token is
 * 401 on every route; a Login as token carries the school audience too, so it hits the same
 * wall), one happy path per controller family, the cross-school fence of notes, overview and
 * audit, limit=101 is 400, and the delete path (approval request, then members cut off).
 */
describe('Platform control E2E', () => {
  const COCKPIT = '/api/v1/auth/cockpit';
  const PLATFORM = '/api/v1/platform';
  const PASSWORD = 'Owner-pass-12345';
  const totp = authenticator.clone({ digits: 6, step: 30, window: 1 });
  const uuid = (n: number) => `00000000-0000-4000-8000-0000003816${String(n).padStart(2, '0')}`;
  const SCHOOL_A = uuid(1);
  const SCHOOL_B = uuid(2);
  const SCHOOL_DEL = uuid(3);
  const MEMBER = { id: uuid(4), email: 'member@pc-e2e.example' };
  const SCHOOL_ARCH = uuid(5);

  let app: INestApplication;
  let ds: DataSource;
  let baseUrl = '';
  let sentCodes: { kind: string; to: string; code?: string }[] = [];
  let parked: string[] = [];

  interface Owner {
    id: string;
    email: string;
    phone: string;
    token: string;
  }
  const http = () => supertest(baseUrl);
  const codeSentTo = (to: string, kind: string) =>
    sentCodes.filter((s) => s.to === to && s.kind === kind).at(-1)?.code as string;
  const freshStep = (userId: string) =>
    ds.query(`UPDATE user_mfa SET last_step = NULL WHERE user_id = $1`, [userId]);
  const auth = (o: Owner) => ({ Authorization: `Bearer ${o.token}` });

  async function makeOwner(): Promise<Owner> {
    const suffix = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
    const email = `pc-e2e-${suffix}@biddaloy.test`;
    const phone = `+88017${suffix.slice(-9).padStart(9, '0')}`;
    const user = await ds.getRepository(User).save(
      ds.getRepository(User).create({
        email,
        phone,
        full_name: 'Platform control e2e owner',
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
    return { id: user.id, email, phone, token: done.body.access_token };
  }

  async function stepUp(o: Owner, scope: ApprovalScope): Promise<string> {
    await freshStep(o.id);
    const res = await http()
      .post(`${PLATFORM}/step-up`)
      .set(auth(o))
      .send({ scope, code: totp.generate(DEV_COCKPIT_TOTP_SECRET) })
      .expect(200);
    return res.body.approval_token;
  }

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
    await app.get(PlatformHomeService).ensure();
    const delivery = app.get(AccountAccessDeliveryService);
    const real = delivery.deliver.bind(delivery);
    vi.spyOn(delivery, 'deliver').mockImplementation((input: any) => {
      sentCodes.push({ kind: input.kind, to: input.to, code: input.vars?.code });
      return real(input);
    });
    for (const [sid, slug] of [
      [SCHOOL_A, 'pc-e2e-a'],
      [SCHOOL_B, 'pc-e2e-b'],
      [SCHOOL_DEL, 'pc-e2e-del'],
      [SCHOOL_ARCH, 'pc-e2e-arch'],
    ]) {
      await ds.query(
        `INSERT INTO schools (id, name, slug, settings, created_at, updated_at)
         VALUES ($1, $2, $2, '{}'::jsonb, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [sid, slug],
      );
    }
    await ds.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'Pc Member', 'ACTIVE', NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [MEMBER.id, MEMBER.email, SEED_ADMIN_PASSWORD_HASH],
    );
    await ds.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [MEMBER.id, SCHOOL_DEL, UserRole.ADMIN],
    );
  }, 90000);

  afterAll(async () => {
    for (const id of parked) {
      await ds.query(`UPDATE users SET status = 'ACTIVE' WHERE id = $1`, [id]);
    }
    await ds.query(`DELETE FROM platform_settings WHERE key = 'approvals.enabled'`);
    vi.restoreAllMocks();
    await app.close();
  });

  it('keeps school-audience tokens out of every Wave 4 route', async () => {
    const school = await http()
      .post('/api/v1/auth/login')
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    const bearer = { Authorization: `Bearer ${school.body.access_token}` };
    const gets = [
      `/schools/${SCHOOL_A}/notes`,
      `/schools/${SCHOOL_A}/overview`,
      '/users?q=admin',
      '/audit',
      '/audit/sessions',
      '/ops/queues',
      '/ops/system',
      '/announcements',
      `/schools/${SCHOOL_A}/archive/export/${uuid(9)}`,
    ];
    for (const path of gets) await http().get(`${PLATFORM}${path}`).set(bearer).expect(401);
    await http().post(`${PLATFORM}/schools/${SCHOOL_A}/notes`).set(bearer).send({}).expect(401);
    await http().delete(`${PLATFORM}/schools/${SCHOOL_A}`).set(bearer).send({}).expect(401);
    await http().patch(`${PLATFORM}/schools/${SCHOOL_A}/name`).set(bearer).send({}).expect(401);
    await http().post(`${PLATFORM}/announcements`).set(bearer).send({}).expect(401);
    await http().post(`${PLATFORM}/ops/queues/x/retry-failed`).set(bearer).expect(401);
    const more: [string, string][] = [
      ['post', `/announcements/preview`],
      ['post', `/schools/${SCHOOL_A}/archive`],
      ['post', `/schools/${SCHOOL_A}/archive/export`],
      ['get', `/schools/${SCHOOL_A}/archive/export/${uuid(9)}/download`],
      ['post', `/schools/${SCHOOL_A}/admins/${uuid(9)}/reset-link`],
      ['post', `/schools/${SCHOOL_A}/logout-all`],
      ['post', `/users/${uuid(9)}/logout`],
      ['delete', `/schools/${SCHOOL_A}/notes/${uuid(9)}`],
      ['post', `/ops/restore-lock/${SCHOOL_A}/release`],
    ];
    for (const [m, path] of more) {
      await (http() as any)[m](`${PLATFORM}${path}`).set(bearer).send({}).expect(401);
    }
    // No bearer at all is the same wall.
    await http().get(`${PLATFORM}/audit`).expect(401);
  }, 60000);

  it('notes: school A notes never show for school B; overview and audit stay inside one school', async () => {
    const a = await makeOwner();
    const added = await http()
      .post(`${PLATFORM}/schools/${SCHOOL_A}/notes`)
      .set(auth(a))
      .send({ text: 'note only for A' })
      .expect(201);
    expect(added.body.text).toBe('note only for A');

    const listA = await http()
      .get(`${PLATFORM}/schools/${SCHOOL_A}/notes`)
      .set(auth(a))
      .expect(200);
    expect(JSON.stringify(listA.body)).toContain('note only for A');
    const listB = await http()
      .get(`${PLATFORM}/schools/${SCHOOL_B}/notes`)
      .set(auth(a))
      .expect(200);
    expect(JSON.stringify(listB.body)).not.toContain('note only for A');
    // Deleting A's note through B's URL finds nothing.
    await http()
      .delete(`${PLATFORM}/schools/${SCHOOL_B}/notes/${added.body.id}`)
      .set(auth(a))
      .expect(404);

    const overviewB = await http()
      .get(`${PLATFORM}/schools/${SCHOOL_B}/overview`)
      .set(auth(a))
      .expect(200);
    expect(overviewB.headers['cache-control']).toContain('no-store');
    // A has one note, B none: the count is per school.
    expect(overviewB.body.notesCount).toBe(0);
    const overviewA = await http()
      .get(`${PLATFORM}/schools/${SCHOOL_A}/overview`)
      .set(auth(a))
      .expect(200);
    expect(overviewA.body.notesCount).toBe(1);

    // Audit for school A returns no row that belongs to school B.
    for (const sid of [SCHOOL_A, SCHOOL_B]) {
      await ds.query(
        `INSERT INTO audit_logs (action, entity_type, entity_id, tenant_id, created_at)
         VALUES ('UPDATE', 'School', $1, $1, NOW())`,
        [sid],
      );
    }
    const audit = await http()
      .get(`${PLATFORM}/audit?tenantId=${SCHOOL_A}`)
      .set(auth(a))
      .expect(200);
    const rows: { tenantId: string }[] = audit.body.items;
    // A's own row is there (not an empty answer), and no row of B.
    expect(rows.some((r) => r.tenantId === SCHOOL_A)).toBe(true);
    expect(rows.some((r) => r.tenantId === SCHOOL_B)).toBe(false);
  }, 90000);

  it('limit=101 is 400 on every list', async () => {
    const a = await makeOwner();
    for (const path of [
      `/schools/${SCHOOL_A}/notes`,
      '/users?q=admin',
      '/audit',
      '/audit/sessions',
      '/announcements',
    ]) {
      const sep = path.includes('?') ? '&' : '?';
      await http().get(`${PLATFORM}${path}${sep}limit=101`).set(auth(a)).expect(400);
    }
  }, 60000);

  it('one happy read per family: users, ops queues, ops system, announcements', async () => {
    const a = await makeOwner();
    await http()
      .get(`${PLATFORM}/users?q=${encodeURIComponent(a.email)}`)
      .set(auth(a))
      .expect(200);
    await http().get(`${PLATFORM}/ops/queues`).set(auth(a)).expect(200);
    await http().get(`${PLATFORM}/ops/system`).set(auth(a)).expect(200);
    await http().get(`${PLATFORM}/announcements`).set(auth(a)).expect(200);
    await http().get(`${PLATFORM}/schools/not-a-uuid/overview`).set(auth(a)).expect(400);
  }, 60000);

  it('restore lock release: needs a step-up token, then clears the real Redis key', async () => {
    const a = await makeOwner();
    const redis = app.get(BULK_IMPORT_REDIS);
    await redis.set(lockKey(SCHOOL_A), 'job-1', 'EX', 60);
    // No step-up token: refused, the lock stays.
    await http().post(`${PLATFORM}/ops/restore-lock/${SCHOOL_A}/release`).set(auth(a)).expect(403);
    expect(await redis.exists(lockKey(SCHOOL_A))).toBe(1);
    const res = await http()
      .post(`${PLATFORM}/ops/restore-lock/${SCHOOL_A}/release`)
      .set(auth(a))
      .set('X-Approval-Token', await stepUp(a, ApprovalScope.PLATFORM_OPS_ACTION));
    expect(res.status).toBeLessThan(300);
    expect(await redis.exists(lockKey(SCHOOL_A))).toBe(0);
  }, 90000);

  it('school delete: with both owners active it asks for approval and deletes nothing', async () => {
    const a = await makeOwner();
    const b = await makeOwner();
    await onlyActive([a.id, b.id]);
    const asked = await http()
      .delete(`${PLATFORM}/schools/${SCHOOL_DEL}`)
      .set(auth(a))
      .set('X-Approval-Token', await stepUp(a, ApprovalScope.PLATFORM_DELETE_SCHOOL))
      .send({ reason: 'e2e wiring check' });
    expect(asked.status).toBe(403);
    expect(JSON.stringify(asked.body)).toContain('APPROVAL_REQUESTED');
    const [row] = await ds.query(`SELECT deleted_at FROM schools WHERE id = $1`, [SCHOOL_DEL]);
    expect(row.deleted_at).toBeNull();
    const requestId: string = JSON.stringify(asked.body).match(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/,
    )![0];

    // The member signs in, then the second owner approves and the first owner deletes.
    const memberLogin = await http()
      .post('/api/v1/auth/login')
      .send({ email: MEMBER.email, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    const memberBearer = { Authorization: `Bearer ${memberLogin.body.access_token}` };
    await http()
      .post(`${PLATFORM}/approvals/${requestId}/approve`)
      .set(auth(b))
      .set('X-Approval-Token', await stepUp(b, ApprovalScope.PLATFORM_APPROVAL_DECIDE))
      .expect(204);
    await http()
      .delete(`${PLATFORM}/schools/${SCHOOL_DEL}`)
      .set(auth(a))
      .set('X-Approval-Token', await stepUp(a, ApprovalScope.PLATFORM_DELETE_SCHOOL))
      .set('X-Platform-Approval', requestId)
      .send({ reason: 'e2e wiring check' })
      .expect(200);

    // The member's old token stops working, and the delete is in the audit log.
    await http()
      .get('/api/v1/users/me')
      .set(memberBearer)
      .set('X-Tenant-ID', SCHOOL_DEL)
      .expect(401);
    const audit = await ds.query(
      `SELECT 1 FROM audit_logs WHERE entity_type = 'School' AND entity_id = $1 AND action = 'DELETE'`,
      [SCHOOL_DEL],
    );
    expect(audit.length).toBeGreaterThan(0);
  }, 180000);

  it('archive: an unknown export job is a 404 that does not echo the id', async () => {
    const a = await makeOwner();
    // Unknown export job: 404 with no echo of the id.
    const res = await http()
      .get(`${PLATFORM}/schools/${SCHOOL_ARCH}/archive/export/${uuid(9)}`)
      .set(auth(a));
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain(uuid(9));
  }, 60000);
});
