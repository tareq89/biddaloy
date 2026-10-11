import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UserRole } from '@biddaloy/shared';
import { AppModule } from '../../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../../validation-pipe';
import { SEED_ADMIN_PASSWORD, SEED_ADMIN_PASSWORD_HASH } from '@test/constants';

/**
 * [68.1.14] PUB-01 + GAP-03 against a real database: `POST /schools/:id/admins` (the same
 * `provisionAdminForSchool` path `POST /schools` uses) never grants ADMIN through a contact
 * the holder has not proved, asks an existing person instead of enrolling them, and never
 * sends an INVITE (which sets a password) to someone who already has one.
 */
describe('POST /schools/:id/admins (e2e) [68.1.14]', () => {
  let app: INestApplication;
  let ds: DataSource;
  let token: string;
  let platformTenantId: string;
  let schoolId: string;

  const run = randomUUID().slice(0, 8);
  const superAdminEmail = `sa-${run}@school-admins-e2e.example`;

  const addAdmin = (body: object) =>
    supertest(app.getHttpServer())
      .post(`/api/v1/schools/${schoolId}/admins`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', platformTenantId)
      .send(body);

  async function insertUser(email: string, opts: { verified: boolean; password: boolean }) {
    const [row] = await ds.query(
      `INSERT INTO users (email, email_verified_at, password_hash, full_name, status)
       VALUES ($1, $2, $3, 'Existing Person', 'ACTIVE') RETURNING id`,
      [email, opts.verified ? new Date() : null, opts.password ? SEED_ADMIN_PASSWORD_HASH : null],
    );
    return row.id as string;
  }

  const memberships = (userId: string) =>
    ds.query(`SELECT role FROM user_tenants WHERE user_id = $1 AND tenant_id = $2`, [
      userId,
      schoolId,
    ]);
  const tokens = (userId: string, purpose: string) =>
    ds.query(`SELECT id FROM auth_tokens WHERE user_id = $1 AND tenant_id = $2 AND purpose = $3`, [
      userId,
      schoolId,
      purpose,
    ]);

  beforeAll(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-production';
    process.env.NODE_ENV = 'test';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    ds = app.get(DataSource);

    // Platform authority = SUPER_ADMIN on the 'default-school' tenant (ContextGuard, no
    // PLATFORM_TENANT_ID in tests). Same setup as cross-tenant-access.e2e-spec.ts.
    await ds.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       SELECT gen_random_uuid(), 'Platform', 'default-school', NOW(), NOW()
       WHERE NOT EXISTS (SELECT 1 FROM schools WHERE slug = 'default-school')`,
    );
    [{ id: platformTenantId }] = await ds.query(
      `SELECT id FROM schools WHERE slug = 'default-school'`,
    );
    const [{ id: superAdminId }] = await ds.query(
      `INSERT INTO users (email, password_hash, full_name, status)
       VALUES ($1, $2, 'School Admins Super Admin', 'ACTIVE') RETURNING id`,
      [superAdminEmail, SEED_ADMIN_PASSWORD_HASH],
    );
    await ds.query(`INSERT INTO user_tenants (user_id, tenant_id, role) VALUES ($1, $2, $3)`, [
      superAdminId,
      platformTenantId,
      UserRole.SUPER_ADMIN,
    ]);

    [{ id: schoolId }] = await ds.query(
      `INSERT INTO schools (name, slug) VALUES ($1, $2) RETURNING id`,
      [`School Admins E2E ${run}`, `school-admins-e2e-${run}`],
    );

    const login = await supertest(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: superAdminEmail, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    token = login.body.access_token;
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  it('refuses a contact held by an unverified account: 409 CONTACT_IN_USE, no membership', async () => {
    const email = `unverified-${run}@school-admins-e2e.example`;
    const holderId = await insertUser(email, { verified: false, password: false });

    const res = await addAdmin({ name: 'Somebody Else', email }).expect(409);

    expect(res.body.details).toEqual({ code: 'CONTACT_IN_USE' });
    // Neutral wording, shared with public registration: never says the holder is unverified.
    expect(res.body.message).not.toMatch(/unverified/i);
    expect(await memberships(holderId)).toHaveLength(0);
    const [{ count }] = await ds.query(
      `SELECT count(*)::int AS count FROM users WHERE email = $1`,
      [email],
    );
    expect(count).toBe(1);
  });

  it('asks a verified non-member: PENDING, one JOIN_SCHOOL request, no membership', async () => {
    const email = `verified-${run}@school-admins-e2e.example`;
    const userId = await insertUser(email, { verified: true, password: false });

    const res = await addAdmin({ name: 'Existing Person', email }).expect(201);

    expect(res.body.admin).toEqual({ user_id: userId, existed: true });
    expect(res.body.invitation.status).toBe('PENDING');
    const joins = await tokens(userId, 'JOIN_SCHOOL');
    expect(joins).toHaveLength(1);
    expect(res.body.invitation.id).toBe(joins[0].id);
    expect(await memberships(userId)).toHaveLength(0);
    expect(await tokens(userId, 'INVITE')).toHaveLength(0);
  });

  it('adds a password-holding existing member as ADMIN with NOT_SENT and no INVITE', async () => {
    const email = `member-${run}@school-admins-e2e.example`;
    const userId = await insertUser(email, { verified: true, password: true });
    await ds.query(`INSERT INTO user_tenants (user_id, tenant_id, role) VALUES ($1, $2, $3)`, [
      userId,
      schoolId,
      UserRole.TEACHER,
    ]);

    const res = await addAdmin({ name: 'Existing Person', email }).expect(201);

    expect(res.body.invitation).toEqual({ id: '', status: 'NOT_SENT' });
    const roles = (await memberships(userId)).map((m: { role: string }) => m.role).sort();
    expect(roles).toEqual([UserRole.ADMIN, UserRole.TEACHER].sort());
    // An INVITE sets a password; this user already has one.
    expect(await tokens(userId, 'INVITE')).toHaveLength(0);
    const [{ password_hash }] = await ds.query(`SELECT password_hash FROM users WHERE id = $1`, [
      userId,
    ]);
    expect(password_hash).toBe(SEED_ADMIN_PASSWORD_HASH);
  });
});
