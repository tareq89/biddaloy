import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcrypt';
import supertest = require('supertest');
import cookieParser = require('cookie-parser');
import { UserRole, UserStatus } from '@biddaloy/shared';
import { AppModule } from '../../app.module';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { SEED_TENANT_ID, SEED_ADMIN_PASSWORD_HASH } from '@test/constants';
import { User } from '../users/entities/user.entity';
import { UserTenant } from './entities/user-tenant.entity';
import { School } from '../schools/entities/school.entity';
import { AuditService } from '../audit/audit.service';
import { AuthService } from './auth.service';
import { LoginAttemptService } from './login-attempt.service';
import { AddAdminPasswordReset1789000000000 } from '../../migrations/1789000000000-AddAdminPasswordReset';

const ACTOR_ID = 'a0000000-0000-4000-8000-000000000001';
const TARGET_ID = 'b0000000-0000-4000-8000-000000000002';
const OTHER_TENANT_ID = 'c0000000-0000-4000-8000-000000000003';
const TARGET_EMAIL = 'admin-reset-target@testschool.com';
const ORIGINAL_PASSWORD = 'password123';
const NEW_PASSWORD = 'new-password-after-admin-reset';

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function refreshCookie(response: supertest.Response): string {
  const headers = response.headers['set-cookie'] as unknown as string[];
  const cookie = headers.find((header) => header.startsWith('__Host-refresh_token='));
  if (!cookie) throw new Error('Expected refresh cookie');
  return cookie.split(';')[0];
}

describe('Admin password reset (real PostgreSQL)', () => {
  let app: INestApplication;
  let db: DataSource;
  let jwt: JwtService;
  let audit: AuditService;
  let actorToken: string;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    module.get(AuthService);
    app = module.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    app.use(cookieParser());
    await app.init();
    db = app.get(DataSource);
    jwt = app.get(JwtService);
    audit = app.get(AuditService);
    await db.getRepository(School).insert({
      id: OTHER_TENANT_ID, name: 'Other reset test school', slug: 'other-reset-test-school',
    });
  }, 60_000);

  beforeEach(async () => {
    await db.getRepository(UserTenant).delete({ user_id: ACTOR_ID });
    await db.getRepository(UserTenant).delete({ user_id: TARGET_ID });
    for (const [id, email] of [[ACTOR_ID, 'admin-reset-actor@testschool.com'], [TARGET_ID, TARGET_EMAIL]]) {
      await db.getRepository(User).upsert({
        id, email, phone: null, full_name: 'Reset test member', status: UserStatus.ACTIVE,
        password_hash: SEED_ADMIN_PASSWORD_HASH, credential_version: 0,
        password_change_required: false, temporary_password_expires_at: null, temporary_password_tenant_id: null, deleted_at: null,
      }, ['id']);
    }
    await db.getRepository(UserTenant).insert([
      { user_id: ACTOR_ID, tenant_id: SEED_TENANT_ID, role: UserRole.ADMIN },
      { user_id: TARGET_ID, tenant_id: SEED_TENANT_ID, role: UserRole.TEACHER },
    ]);
    await app.get(LoginAttemptService).reset(TARGET_EMAIL);
    actorToken = token(ACTOR_ID, UserRole.ADMIN);
  });

  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => { await app?.close(); });

  function token(id: string, role: UserRole, extra: Record<string, unknown> = {}) {
    return jwt.sign({ sub: id, jti: randomUUID(), credential_version: 0,
      memberships: [{ tenantId: SEED_TENANT_ID, role }], ...extra });
  }

  function reset(targetId = TARGET_ID, bearer = actorToken, role: UserRole = UserRole.ADMIN, tenant = SEED_TENANT_ID) {
    return supertest(app.getHttpServer()).post(`/api/v1/users/${targetId}/reset-password`)
      .set('Authorization', `Bearer ${bearer}`).set('X-Tenant-ID', tenant).set('X-Role', role);
  }

  function login(password: string) {
    return supertest(app.getHttpServer()).post('/api/v1/auth/login').send({ email: TARGET_EMAIL, password });
  }

  function complete(resetToken: string, password = NEW_PASSWORD) {
    return supertest(app.getHttpServer()).post('/api/v1/auth/complete-password-reset')
      .send({ reset_token: resetToken, new_password: password });
  }

  function me(bearer: string) {
    return supertest(app.getHttpServer()).get('/api/v1/users/me')
      .set('Authorization', `Bearer ${bearer}`).set('X-Tenant-ID', SEED_TENANT_ID).set('X-Role', UserRole.TEACHER);
  }

  async function challenge() {
    const resetResponse = await reset().send({}).expect(200);
    const loginResponse = await login(resetResponse.body.temporary_password).expect(200);
    return { resetResponse, loginResponse, resetToken: loginResponse.body.reset_token as string };
  }

  async function currentUser() {
    return db.getRepository(User).findOneByOrFail({ id: TARGET_ID });
  }

  async function auditRows() {
    return db.query('SELECT * FROM audit_logs WHERE entity_id = $1 AND new_values->>\'scope\' LIKE \'admin_password_reset%\' ORDER BY created_at', [TARGET_ID]);
  }

  it('revokes old credentials immediately, forces replacement, and audits both actors without secrets', async () => {
    const oldSession = await login(ORIGINAL_PASSWORD).expect(200);
    const { resetResponse, loginResponse, resetToken } = await challenge();
    expect(resetResponse.headers['cache-control']).toBe('no-store');
    expect(resetResponse.headers['set-cookie']).toBeUndefined();
    expect(resetResponse.body.temporary_password).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(Date.parse(resetResponse.body.expires_at) - Date.now()).toBeGreaterThan(23 * 60 * 60_000);
    expect(Date.parse(resetResponse.body.expires_at) - Date.now()).toBeLessThanOrEqual(24 * 60 * 60_000);
    const pending = await currentUser();
    expect(pending.password_change_required).toBe(true);
    expect(pending.credential_version).toBe(1);
    expect(pending.temporary_password_tenant_id).toBe(SEED_TENANT_ID);
    expect(await bcrypt.compare(resetResponse.body.temporary_password, pending.password_hash!)).toBe(true);
    await login(ORIGINAL_PASSWORD).expect(401);
    await me(oldSession.body.access_token).expect(401);
    await supertest(app.getHttpServer()).post('/api/v1/auth/refresh')
      .set('Cookie', refreshCookie(oldSession)).expect(401);
    expect(loginResponse.body).toEqual({ password_change_required: true, reset_token: expect.any(String), expires_at: expect.any(String) });
    expect(refreshCookie(loginResponse)).toBe('__Host-refresh_token=');
    expect(loginResponse.headers['cache-control']).toBe('no-store');
    expect(Date.parse(loginResponse.body.expires_at) - Date.now()).toBeLessThanOrEqual(5 * 60_000);
    await me(resetToken).expect(401);
    const finished = await complete(resetToken).expect(204);
    expect(finished.headers['cache-control']).toBe('no-store');
    expect(refreshCookie(finished)).toBe('__Host-refresh_token=');
    await complete(resetToken).expect(400);
    await login(resetResponse.body.temporary_password).expect(401);
    const freshSession = await login(NEW_PASSWORD).expect(200);
    await me(freshSession.body.access_token).expect(200);
    const fresh = await currentUser();
    expect(fresh.credential_version).toBe(2);
    expect(fresh.password_change_required).toBe(false);
    expect(fresh.temporary_password_expires_at).toBeNull();
    expect(fresh.temporary_password_tenant_id).toBeNull();
    const rows = await auditRows();
    expect(rows.map((row: { performed_by_user_id: string }) => row.performed_by_user_id)).toEqual([ACTOR_ID, TARGET_ID]);
    expect(rows.map((row: { new_values: unknown }) => row.new_values)).toEqual([
      { scope: 'admin_password_reset' }, { scope: 'admin_password_reset_completed' },
    ]);
    for (const row of rows) {
      expect(row.tenant_id).toBe(SEED_TENANT_ID);
      expect(row.old_values).toBeNull();
      expect(JSON.stringify(row)).not.toContain(resetResponse.body.temporary_password);
      expect(JSON.stringify(row)).not.toContain(resetToken);
      expect(JSON.stringify(row)).not.toContain(pending.password_hash);
    }
  });

  it('strictly rejects the already-removed PATCH password field and preserves supported updates', async () => {
    const patch = () => supertest(app.getHttpServer()).patch(`/api/v1/users/${TARGET_ID}`)
      .set('Authorization', `Bearer ${actorToken}`).set('X-Tenant-ID', SEED_TENANT_ID).set('X-Role', UserRole.ADMIN);
    await patch().send({ password: 'ignored-no-longer' }).expect(400);
    await patch().send({ full_name: 'Updated member' }).expect(200);
    expect((await currentUser()).password_hash).toBe(SEED_ADMIN_PASSWORD_HASH);
  });

  it.each([UserRole.EXECUTIVE, UserRole.ACCOUNTANT, UserRole.TEACHER, UserRole.PARENT, UserRole.STUDENT])('denies %s even with a real membership', async (role) => {
    await db.getRepository(UserTenant).update({ user_id: ACTOR_ID }, { role });
    await reset(TARGET_ID, token(ACTOR_ID, role), role).send({}).expect(401);
    expect((await currentUser()).credential_version).toBe(0);
  });

  it('denies unauthenticated, forged-role, foreign-tenant, and removed-admin requests', async () => {
    await supertest(app.getHttpServer()).post(`/api/v1/users/${TARGET_ID}/reset-password`).send({}).expect(401);
    await reset(TARGET_ID, token(ACTOR_ID, UserRole.TEACHER)).send({}).expect(401);
    await reset(TARGET_ID, actorToken, UserRole.ADMIN, OTHER_TENANT_ID).send({}).expect(401);
    await db.getRepository(UserTenant).delete({ user_id: ACTOR_ID });
    await reset().send({}).expect(403);
  });

  it('rejects uppercase self IDs, bad UUIDs and caller-controlled credentials/context', async () => {
    await reset(ACTOR_ID.toUpperCase()).send({}).expect(400);
    await reset('not-a-uuid').send({}).expect(400);
    for (const body of [{ password: 'chosen' }, { email: 'attacker@example.com' }, { tenant_id: OTHER_TENANT_ID }, { role: UserRole.ADMIN }]) {
      await reset().send(body).expect(400);
    }
  });

  it('makes unknown and out-of-school accounts indistinguishable, and refuses shared identities', async () => {
    const missing = await reset(randomUUID()).send({}).expect(404);
    await db.getRepository(UserTenant).update({ user_id: TARGET_ID }, { tenant_id: OTHER_TENANT_ID });
    const foreign = await reset().send({}).expect(404);
    expect(foreign.body.message).toEqual(missing.body.message);
    await db.getRepository(UserTenant).insert({ user_id: TARGET_ID, tenant_id: SEED_TENANT_ID, role: UserRole.TEACHER });
    const shared = await reset().send({}).expect(409);
    expect(JSON.stringify(shared.body)).not.toContain(OTHER_TENANT_ID);
    expect((await currentUser()).credential_version).toBe(0);
  });

  it('allows several roles within one school and initializes an account with no existing password', async () => {
    await db.getRepository(UserTenant).insert({ user_id: TARGET_ID, tenant_id: SEED_TENANT_ID, role: UserRole.PARENT });
    await db.getRepository(User).update(TARGET_ID, { password_hash: null });
    const { resetToken } = await challenge();
    await complete(resetToken).expect(204);
    const session = await login(NEW_PASSWORD).expect(200);
    expect(session.body.memberships).toHaveLength(2);
  });

  it('refuses inactive, deleted and uncontactable accounts without mutation', async () => {
    await db.getRepository(User).update(TARGET_ID, { status: UserStatus.INACTIVE });
    await reset().send({}).expect(409);
    await db.getRepository(User).update(TARGET_ID, { status: UserStatus.ACTIVE, email: null, phone: null });
    await reset().send({}).expect(409);
    await db.getRepository(User).softDelete(TARGET_ID);
    await reset().send({}).expect(404);
  });

  it('rolls back password, version and refresh revocation when reset audit fails', async () => {
    const session = await login(ORIGINAL_PASSWORD).expect(200);
    const record = audit.record.bind(audit);
    vi.spyOn(audit, 'record').mockImplementation((entry, manager) => {
      if (entry.new_values?.scope === 'admin_password_reset') throw new Error('Test audit failure');
      return record(entry, manager);
    });
    await reset().send({}).expect(500);
    expect((await currentUser()).credential_version).toBe(0);
    expect((await currentUser()).password_hash).toBe(SEED_ADMIN_PASSWORD_HASH);
    expect(await auditRows()).toHaveLength(0);
    await me(session.body.access_token).expect(200);
    await supertest(app.getHttpServer()).post('/api/v1/auth/refresh').set('Cookie', refreshCookie(session)).expect(200);
  });

  it('rolls back completion on audit failure and allows retrying the same challenge', async () => {
    const { resetToken } = await challenge();
    const record = audit.record.bind(audit);
    const spy = vi.spyOn(audit, 'record').mockImplementation((entry, manager) => {
      if (entry.new_values?.scope === 'admin_password_reset_completed') throw new Error('Test audit failure');
      return record(entry, manager);
    });
    await complete(resetToken).expect(500);
    expect((await currentUser()).credential_version).toBe(1);
    spy.mockRestore();
    await complete(resetToken).expect(204);
  });

  it('does not lose the issued credential if clearing a Redis lockout fails after commit', async () => {
    vi.spyOn(app.get(LoginAttemptService), 'reset').mockRejectedValue(new Error('Test Redis outage'));
    const result = await reset().send({}).expect(200);
    expect(await bcrypt.compare(result.body.temporary_password, (await currentUser()).password_hash!)).toBe(true);
  });

  it('rejects reused temporary passwords and invalid, expired, or incorrectly scoped challenges', async () => {
    const { resetToken, resetResponse } = await challenge();
    await complete(resetToken, resetResponse.body.temporary_password).expect(400);
    const payload = jwt.decode(resetToken) as Record<string, unknown>;
    const { exp: _exp, iat: _iat, ...claims } = payload;
    const tokens = [
      'garbage', token(TARGET_ID, UserRole.TEACHER),
      jwt.sign({ ...claims, purpose: 'access' }),
      jwt.sign({ ...claims, sub: 'invalid' }),
      jwt.sign({ ...claims, tenant_id: OTHER_TENANT_ID }),
      jwt.sign({ ...claims, credential_version: null }),
      jwt.sign({ ...claims, credential_version: -1 }),
      jwt.sign({ ...claims, credential_version: 1.5 }),
      jwt.sign(claims, { expiresIn: -1 }),
      jwt.sign(claims, { secret: 'different-test-secret' }),
    ];
    for (const invalid of tokens) await complete(invalid).expect(400);
    await supertest(app.getHttpServer()).post('/api/v1/auth/complete-password-reset')
      .send({ reset_token: resetToken, new_password: NEW_PASSWORD, user_id: TARGET_ID }).expect(400);
    await complete('x'.repeat(4097)).expect(400);
    await complete(resetToken, '').expect(400);
    await complete(resetToken).expect(204);
  });

  it('expires temporary credentials and supersedes earlier challenges on another reset', async () => {
    const first = await challenge();
    await db.getRepository(User).update(TARGET_ID, { temporary_password_expires_at: new Date(Date.now() - 1_000) });
    await login(first.resetResponse.body.temporary_password).expect(401);
    await complete(first.resetToken).expect(400);
    const second = await challenge();
    await login(first.resetResponse.body.temporary_password).expect(401);
    await complete(first.resetToken).expect(400);
    await complete(second.resetToken).expect(204);
  });

  it('permits exactly one concurrent completion', async () => {
    const { resetToken } = await challenge();
    const results = await Promise.all([complete(resetToken), complete(resetToken)]);
    expect(results.map((response) => response.status).sort()).toEqual([204, 400]);
    expect((await currentUser()).credential_version).toBe(2);
    expect(await auditRows()).toHaveLength(2);
  });

  it('cannot overwrite reset credentials or issue a usable session when login straddles reset', async () => {
    const gate = holdAudit('login');
    const loggingIn = login(ORIGINAL_PASSWORD).then((response) => response);
    await gate.entered;
    try {
      const result = await reset().send({}).expect(200);
      gate.release();
      const stale = await loggingIn;
      expect(stale.status).toBe(200);
      await me(stale.body.access_token).expect(401);
      await supertest(app.getHttpServer()).post('/api/v1/auth/refresh')
        .set('Cookie', refreshCookie(stale)).expect(401);
      expect(await bcrypt.compare(result.body.temporary_password, (await currentUser()).password_hash!)).toBe(true);
    } finally {
      gate.release();
      await loggingIn;
      gate.restore();
    }
  });

  it('refuses an ordinary self-change that validated a snapshot superseded by reset', async () => {
    const session = await login(ORIGINAL_PASSWORD).expect(200);
    const repo = db.getRepository(User);
    const findOne = repo.findOne.bind(repo);
    const entered = deferred();
    const release = deferred();
    let reads = 0;
    const spy = vi.spyOn(repo, 'findOne').mockImplementation(async (options) => {
      const user = await findOne(options);
      // First read is JwtStrategy; second is AuthService's password snapshot.
      if (user?.id === TARGET_ID && ++reads === 2) {
        entered.resolve();
        await release.promise;
      }
      return user;
    });
    const changing = supertest(app.getHttpServer()).post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${session.body.access_token}`)
      .send({ current_password: ORIGINAL_PASSWORD, new_password: NEW_PASSWORD })
      .then((response) => response);
    await entered.promise;
    try {
      const result = await reset().send({}).expect(200);
      release.resolve();
      expect((await changing).status).toBe(403);
      expect((await currentUser()).credential_version).toBe(1);
      expect(await bcrypt.compare(result.body.temporary_password, (await currentUser()).password_hash!)).toBe(true);
    } finally {
      release.resolve();
      await changing;
      spy.mockRestore();
    }
  });

  it('supports legacy version-zero JWTs but rejects malformed versions and reset-purpose tokens', async () => {
    const legacy = { sub: TARGET_ID, jti: randomUUID(), memberships: [{ tenantId: SEED_TENANT_ID, role: UserRole.TEACHER }] };
    await me(jwt.sign(legacy)).expect(200);
    for (const credential_version of [null, -1, 0.5, '0', 1]) {
      await me(jwt.sign({ ...legacy, credential_version })).expect(401);
    }
    await me(jwt.sign({ ...legacy, purpose: 'complete_password_reset' })).expect(401);
    await reset().send({}).expect(200);
    await me(jwt.sign(legacy)).expect(401);
  });

  it('blocks downgrade while temporary credentials exist, including expired ones, and round-trips an idle schema', async () => {
    const migration = new AddAdminPasswordReset1789000000000();
    const runner = db.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      await runner.query('UPDATE users SET password_change_required = true, temporary_password_expires_at = NOW() - INTERVAL \'1 day\' WHERE id = $1', [TARGET_ID]);
      await expect(migration.down(runner)).rejects.toThrow('Cannot roll back');
      await runner.query('UPDATE users SET password_change_required = false WHERE id = $1', [TARGET_ID]);
      await migration.down(runner);
      await migration.up(runner);
      const [row] = await runner.query('SELECT credential_version, password_change_required FROM users WHERE id = $1', [TARGET_ID]);
      expect(row).toEqual({ credential_version: 0, password_change_required: false });
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  });

  // Stop the real transaction after its row locks are held, immediately before
  // its real audit write. Competing queries run on another PostgreSQL connection;
  // pg_blocking_pids proves the wait rather than relying on arbitrary sleeps.
  function holdAudit(scope: string) {
    const entered = deferred<number>();
    const release = deferred();
    const record = audit.record.bind(audit);
    const spy = vi.spyOn(audit, 'record').mockImplementation(async (entry, manager) => {
      if (entry.new_values?.scope === scope ||
        (scope === 'login' && entry.action === 'LOGIN' && entry.performed_by_user_id === TARGET_ID)) {
        const [row] = await (manager ?? db.manager).query('SELECT pg_backend_pid() AS pid');
        entered.resolve(row.pid);
        await release.promise;
      }
      return record(entry, manager);
    });
    return { entered: entered.promise, release: () => release.resolve(), restore: () => spy.mockRestore() };
  }

  async function connection() {
    const runner = db.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    await runner.query("SET LOCAL statement_timeout = '5s'");
    const [row] = await runner.query('SELECT pg_backend_pid() AS pid');
    return { runner, pid: row.pid as number };
  }

  async function assertBlocked(pid: number, blocker?: number) {
    await expect.poll(async () => {
      const [row] = await db.query('SELECT pg_blocking_pids($1) AS blockers', [pid]);
      return blocker === undefined ? row.blockers.length > 0 : row.blockers.includes(blocker);
    }, { timeout: 3_000, interval: 10 }).toBe(true);
  }

  const membershipChanges = [
    ['insert', 'INSERT INTO user_tenants (user_id, tenant_id, role) VALUES ($1, $2, \'PARENT\')'],
    ['tenant update', 'UPDATE user_tenants SET tenant_id = $2 WHERE user_id = $1'],
    ['removal', 'DELETE FROM user_tenants WHERE user_id = $1 AND tenant_id <> $2'],
  ] as const;

  it.each(membershipChanges)('serializes a membership %s behind reset and refuses the now-ineligible temporary login', async (_name, sql) => {
    const gate = holdAudit('admin_password_reset');
    const resetting = reset().send({}).then((response) => response);
    const resetPid = await gate.entered;
    const { runner, pid } = await connection();
    let changing: Promise<unknown> | undefined;
    try {
      changing = runner.query(sql, [TARGET_ID, OTHER_TENANT_ID]);
      await assertBlocked(pid, resetPid);
      gate.release();
      const result = await resetting;
      expect(result.status).toBe(200);
      await changing;
      await runner.commitTransaction();
      await login(result.body.temporary_password).expect(401);
    } finally {
      gate.release();
      await resetting;
      await changing?.catch(() => undefined);
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      await runner.release();
      gate.restore();
    }
  });

  it.each(membershipChanges)('rechecks eligibility when membership %s wins before reset', async (_name, sql) => {
    const { runner, pid } = await connection();
    let resetting: Promise<supertest.Response> | undefined;
    try {
      await runner.query(sql, [TARGET_ID, OTHER_TENANT_ID]);
      resetting = reset().send({}).then((response) => response);
      await expect.poll(async () => {
        const rows = await db.query("SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND $1 = ANY(pg_blocking_pids(pid))", [pid]);
        return rows.length;
      }, { timeout: 3_000, interval: 10 }).toBeGreaterThan(0);
      await runner.commitTransaction();
      expect([404, 409]).toContain((await resetting).status);
      expect((await currentUser()).credential_version).toBe(0);
    } finally {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      await runner.release();
      await resetting;
    }
  });

  it('holds the User FK lock through completion so a new membership cannot cross password replacement', async () => {
    const { resetToken, resetResponse } = await challenge();
    const gate = holdAudit('admin_password_reset_completed');
    const completing = complete(resetToken).then((response) => response);
    const completionPid = await gate.entered;
    const { runner, pid } = await connection();
    let inserting: Promise<unknown> | undefined;
    try {
      inserting = runner.query(membershipChanges[0][1], [TARGET_ID, OTHER_TENANT_ID]);
      await assertBlocked(pid, completionPid);
      gate.release();
      expect((await completing).status).toBe(204);
      await inserting;
      await runner.commitTransaction();
      await login(resetResponse.body.temporary_password).expect(401);
      await complete(resetToken).expect(400);
      expect((await currentUser()).password_change_required).toBe(false);
    } finally {
      gate.release();
      await completing;
      await inserting?.catch(() => undefined);
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      await runner.release();
      gate.restore();
    }
  });

  it('rejects a challenge when another-school membership commits before completion', async () => {
    const { resetToken } = await challenge();
    await db.getRepository(UserTenant).insert({ user_id: TARGET_ID, tenant_id: OTHER_TENANT_ID, role: UserRole.PARENT });
    await complete(resetToken).expect(400);
    expect((await currentUser()).password_change_required).toBe(true);
  });

  it('does not let a temporary password follow the account to a different sole school', async () => {
    const { resetToken, resetResponse } = await challenge();
    await db.getRepository(UserTenant).update({ user_id: TARGET_ID }, { tenant_id: OTHER_TENANT_ID });
    await login(resetResponse.body.temporary_password).expect(401);
    await complete(resetToken).expect(400);
    const { exp: _exp, iat: _iat, ...claims } = jwt.decode(resetToken);
    // Even a correctly signed challenge for the new school cannot override origin.
    await complete(jwt.sign({ ...claims, tenant_id: OTHER_TENANT_ID })).expect(400);
    expect((await currentUser()).temporary_password_tenant_id).toBe(SEED_TENANT_ID);
  });

  it.each(['inactive', 'deleted', 'removed'] as const)('rejects completion if the account becomes %s', async (state) => {
    const { resetToken } = await challenge();
    if (state === 'inactive') await db.getRepository(User).update(TARGET_ID, { status: UserStatus.INACTIVE });
    if (state === 'deleted') await db.getRepository(User).softDelete(TARGET_ID);
    if (state === 'removed') await db.getRepository(UserTenant).delete({ user_id: TARGET_ID });
    await complete(resetToken).expect(400);
    const [row] = await db.query('SELECT credential_version FROM users WHERE id = $1', [TARGET_ID]);
    expect(row.credential_version).toBe(1);
  });

  it('rejects a challenge that expires while waiting for the credential lock', async () => {
    const { resetToken } = await challenge();
    const { exp: _exp, iat: _iat, ...claims } = jwt.decode(resetToken);
    const shortToken = jwt.sign(claims, { expiresIn: 2 });
    const expiry = jwt.decode(shortToken).exp * 1000;
    const { runner, pid } = await connection();
    let completing: Promise<supertest.Response> | undefined;
    try {
      await runner.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [TARGET_ID]);
      completing = complete(shortToken).then((response) => response);
      await expect.poll(async () => {
        const rows = await db.query('SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND $1 = ANY(pg_blocking_pids(pid))', [pid]);
        return rows.length;
      }, { timeout: 1_000, interval: 10 }).toBeGreaterThan(0);
      await expect.poll(() => Date.now(), { timeout: 3_000, interval: 20 }).toBeGreaterThanOrEqual(expiry);
      await runner.commitTransaction();
      expect((await completing).status).toBe(400);
      expect((await currentUser()).password_change_required).toBe(true);
    } finally {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      await runner.release();
      await completing;
    }
  });
});
