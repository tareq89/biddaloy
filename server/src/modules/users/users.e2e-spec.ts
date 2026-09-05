import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { createHash } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { DataSource } from 'typeorm';
import { UserRole } from '@biddaloy/shared';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_USER_ID,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
} from '@test/constants';

/**
 * E2E tests for the [8.11.8] staff-management backend surface:
 * - GET /users role + search filters
 * - GET /teachers user_id filter (promote-dialog exclusion)
 * - DELETE /users/{id} self-removal guard (trust boundary)
 * - GET /audit-logs performed_by_user_id filter
 * - Tenant isolation: a member of tenant A must not be searchable via a
 *   tenant B context.
 */

describe('Users & Teachers E2E [8.11.8]', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let adminToken: string;

  const TENANT_A = SEED_TENANT_ID;
  const TENANT_B = '00000000-0000-4000-8000-000000000299';
  // Members created for this suite (fixed ids so re-runs stay idempotent)
  const MEMBER_A_ID = '00000000-0000-4000-8000-000000000211';
  const MEMBER_B_ID = '00000000-0000-4000-8000-000000000212';

  const request = () => supertest(app.getHttpServer());

  beforeAll(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-production';
    process.env.NODE_ENV = 'test';
    // [12.1] D6 — echoes the raw invitation token in the response so this
    // suite can assert on it without scraping a delivery provider. Must be
    // set before AppModule compiles: ConfigService's cache is built once
    // at bootstrap.
    process.env.ACCOUNT_ACCESS_ECHO_SECRETS = 'true';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();

    dataSource = app.get(DataSource);

    // Second school, with the seed admin as ADMIN there too — lets one
    // login exercise both tenant contexts via X-Tenant-ID.
    await dataSource.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, 'Staff E2E Other School', 'staff-e2e-other-school', NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
      [TENANT_B],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [SEED_ADMIN_USER_ID, TENANT_B, UserRole.ADMIN],
    );

    // One member in each tenant, distinctly named so search results are
    // unambiguous.
    await dataSource.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, 'staff-a@example.com', $2, 'Anwara TenantA Member', 'ACTIVE', NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
      [MEMBER_A_ID, SEED_ADMIN_PASSWORD_HASH],
    );
    await dataSource.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, 'staff-b@example.com', $2, 'Borhan TenantB Member', 'ACTIVE', NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
      [MEMBER_B_ID, SEED_ADMIN_PASSWORD_HASH],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [MEMBER_A_ID, TENANT_A, UserRole.TEACHER],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [MEMBER_B_ID, TENANT_B, UserRole.TEACHER],
    );

    const loginRes = await request()
      .post('/api/v1/auth/login')
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    adminToken = loginRes.body.access_token;
  }, 60000);

  afterAll(async () => {
    // Leave the shared seed database as we found it.
    await dataSource.query('DELETE FROM teachers WHERE user_id = ANY($1)', [
      [MEMBER_A_ID, MEMBER_B_ID],
    ]);
    await dataSource.query('DELETE FROM user_tenants WHERE user_id = ANY($1)', [
      [MEMBER_A_ID, MEMBER_B_ID],
    ]);
    await dataSource.query('DELETE FROM users WHERE id = ANY($1)', [[MEMBER_A_ID, MEMBER_B_ID]]);
    await dataSource.query('DELETE FROM user_tenants WHERE user_id = $1 AND tenant_id = $2', [
      SEED_ADMIN_USER_ID,
      TENANT_B,
    ]);
    await dataSource.query('DELETE FROM schools WHERE id = $1', [TENANT_B]);
    await app.close();
  });

  describe('GET /users (role + search filters)', () => {
    it('filters by role', async () => {
      const res = await request()
        .get('/api/v1/users')
        .query({ role: UserRole.TEACHER })
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_A)
        .expect(200);

      // Member A holds TEACHER in tenant A; the seed admin holds ADMIN and
      // must be excluded. (UserResponseDto now also carries the
      // tenant-scoped membership role — asserted below.)
      const ids = res.body.data.map((u: { id: string }) => u.id);
      expect(ids).toContain(MEMBER_A_ID);
      expect(ids).not.toContain(SEED_ADMIN_USER_ID);
      const memberA = res.body.data.find((u: { id: string }) => u.id === MEMBER_A_ID);
      expect(memberA.role).toBe(UserRole.TEACHER);
    });

    it('searches by full_name, case-insensitively', async () => {
      const res = await request()
        .get('/api/v1/users')
        .query({ search: 'anwara tenanta' })
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_A)
        .expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].id).toBe(MEMBER_A_ID);
    });

    it('searches by email', async () => {
      const res = await request()
        .get('/api/v1/users')
        .query({ search: 'staff-a@example' })
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_A)
        .expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].email).toBe('staff-a@example.com');
    });

    // Tenant isolation: tenant B's member must not surface through a
    // tenant A context — even for the same (admin) caller, on exact match.
    it("does not expose another tenant's member via search", async () => {
      const res = await request()
        .get('/api/v1/users')
        .query({ search: 'Borhan TenantB Member' })
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_A)
        .expect(200);

      expect(res.body.data).toEqual([]);
      expect(res.body.total).toBe(0);
    });

    it('rejects an unknown role value with 400', async () => {
      await request()
        .get('/api/v1/users')
        .query({ role: 'NOT_A_ROLE' })
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_A)
        .expect(400);
    });
  });

  describe('GET /teachers (user_id filter)', () => {
    it('returns only the teacher profile for the given user_id', async () => {
      // Promote member A in tenant A
      await request()
        .post('/api/v1/teachers')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_A)
        .send({ user_id: MEMBER_A_ID, employee_id: 'E2E-STAFF-001' })
        .expect(201);

      const res = await request()
        .get('/api/v1/teachers')
        .query({ user_id: MEMBER_A_ID })
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_A)
        .expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].user.id).toBe(MEMBER_A_ID);
    });

    it('returns an empty list for a member with no teacher profile', async () => {
      const res = await request()
        .get('/api/v1/teachers')
        .query({ user_id: SEED_ADMIN_USER_ID })
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_A)
        .expect(200);

      expect(res.body.data).toEqual([]);
    });

    it('rejects a non-UUID user_id with 400', async () => {
      await request()
        .get('/api/v1/teachers')
        .query({ user_id: 'not-a-uuid' })
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_A)
        .expect(400);
    });
  });

  describe('DELETE /users/{id} (self-removal guard)', () => {
    it('refuses to remove the requesting admin with 400 and a clear message', async () => {
      const res = await request()
        .delete(`/api/v1/users/${SEED_ADMIN_USER_ID}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_A)
        .expect(400);

      expect(res.body.message).toBe('You cannot remove your own account from this school');

      // The membership must still exist (the admin is not locked out)
      await request()
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_A)
        .expect(200);
    });

    it('still removes another member, deleting only the membership row', async () => {
      await request()
        .delete(`/api/v1/users/${MEMBER_A_ID}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_A)
        .expect(200);

      // Membership row gone…
      const memberships = await dataSource.query(
        'SELECT 1 FROM user_tenants WHERE user_id = $1 AND tenant_id = $2',
        [MEMBER_A_ID, TENANT_A],
      );
      expect(memberships).toEqual([]);

      // …but the global account survives, undeleted.
      const [row] = await dataSource.query('SELECT deleted_at FROM users WHERE id = $1', [
        MEMBER_A_ID,
      ]);
      expect(row).toBeDefined();
      expect(row.deleted_at).toBeNull();
    });
  });

  describe('GET /audit-logs (performed_by_user_id filter)', () => {
    it('returns only rows performed by the given user', async () => {
      // audit_logs is truncated before every test (test/setup.ts), so the
      // beforeAll login's row is gone — write a fresh LOGIN row here.
      await request()
        .post('/api/v1/auth/login')
        .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
        .expect(200);

      const res = await request()
        .get('/api/v1/audit-logs')
        .query({ performed_by_user_id: SEED_ADMIN_USER_ID })
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_A)
        .expect(200);

      expect(res.body.data.length).toBeGreaterThan(0);
      for (const log of res.body.data) {
        expect(log.performed_by_user_id).toBe(SEED_ADMIN_USER_ID);
      }
    });

    // [8.11.10]: the tenant-wide audit screen renders a "Who" column, so
    // `findAll` left-joins the acting user and flattens their name onto
    // each row. Asserted against a real database because the failure mode
    // is a SQL/relation-mapping one a mocked query builder cannot catch.
    it('returns the acting user’s name, not just their id', async () => {
      await request()
        .post('/api/v1/auth/login')
        .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
        .expect(200);

      const res = await request()
        .get('/api/v1/audit-logs')
        .query({ performed_by_user_id: SEED_ADMIN_USER_ID })
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_A)
        .expect(200);

      expect(res.body.data.length).toBeGreaterThan(0);
      for (const log of res.body.data) {
        expect(typeof log.performed_by_name).toBe('string');
        expect(log.performed_by_name.length).toBeGreaterThan(0);
      }
      // The join must not widen the response into the whole User row —
      // no credential or contact column may ride along with the name.
      expect(res.body.data[0]).not.toHaveProperty('performed_by');
    });

    // The entity-scoped sibling never joins the relation, so its rows are
    // deliberately nameless — its caller (a student's Activity tab) shows
    // no "Who" column.
    it('leaves performed_by_name null on the entity-scoped route', async () => {
      const res = await request()
        .get(`/api/v1/audit-logs/entity/User/${SEED_ADMIN_USER_ID}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_A)
        .expect(200);

      for (const log of res.body.data) {
        expect(log.performed_by_name).toBeNull();
      }
    });

    it('rejects a non-UUID performed_by_user_id with 400', async () => {
      await request()
        .get('/api/v1/audit-logs')
        .query({ performed_by_user_id: 'not-a-uuid' })
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_A)
        .expect(400);
    });
  });

  describe('authorization and tenant-context boundaries', () => {
    let teacherToken: string;

    beforeAll(async () => {
      // Member A is a TEACHER in tenant A — the denied side of every
      // ADMIN/EXECUTIVE-only endpoint this suite covers. The self-removal
      // suite above deleted this membership; restore it before login so
      // the JWT carries the TEACHER membership again.
      await dataSource.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW())
         ON CONFLICT DO NOTHING`,
        [MEMBER_A_ID, TENANT_A, UserRole.TEACHER],
      );
      const res = await request()
        .post('/api/v1/auth/login')
        .send({ email: 'staff-a@example.com', password: SEED_ADMIN_PASSWORD })
        .expect(200);
      teacherToken = res.body.access_token;
    });

    it('denies a TEACHER creating a user (ADMIN/EXECUTIVE only)', async () => {
      const res = await request()
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${teacherToken}`)
        .set('X-Tenant-ID', TENANT_A)
        .send({ full_name: 'Should Not Exist', role: UserRole.TEACHER })
        .expect(401);
      expect(res.body.message).toContain('Requires one of roles');
    });

    it('denies a TEACHER removing a member (ADMIN only)', async () => {
      const res = await request()
        .delete(`/api/v1/users/${MEMBER_A_ID}`)
        .set('Authorization', `Bearer ${teacherToken}`)
        .set('X-Tenant-ID', TENANT_A)
        .expect(401);
      expect(res.body.message).toContain('Requires one of roles');
    });

    it('denies a TEACHER reading audit logs (ADMIN only)', async () => {
      const res = await request()
        .get('/api/v1/audit-logs')
        .set('Authorization', `Bearer ${teacherToken}`)
        .set('X-Tenant-ID', TENANT_A)
        .expect(401);
      expect(res.body.message).toContain('Requires one of roles');
    });

    it('rejects a request with no X-Tenant-ID header', async () => {
      await request().get('/api/v1/users').set('Authorization', `Bearer ${adminToken}`).expect(401);
    });

    it('rejects a tenant the caller is not a member of', async () => {
      // Member A belongs to tenant A only — presenting tenant B's id
      // must fail context resolution, not fall through to data access.
      await request()
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${teacherToken}`)
        .set('X-Tenant-ID', TENANT_B)
        .expect(401);
    });
  });

  describe('invitations [12.1]', () => {
    it('POST /users without a password returns invitation.status and, with the echo flag, a debug.token that hashes to the stored auth_tokens row', async () => {
      const res = await request()
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_A)
        .send({
          full_name: 'Passwordless Invitee',
          email: 'invitee-e2e@example.com',
          role: UserRole.TEACHER,
          tenantId: TENANT_A,
        })
        .expect(201);

      expect(res.body.user.invitation_status).toBe('PENDING');
      expect(res.body.invitation).not.toBeNull();
      expect(res.body.invitation.debug).toBeDefined();

      const rawToken = res.body.invitation.debug.token as string;
      const expectedHash = createHash('sha256').update(rawToken, 'utf8').digest('hex');
      const [row] = await dataSource.query(
        `SELECT token_hash FROM auth_tokens WHERE user_id = $1 AND purpose = 'INVITE' ORDER BY created_at DESC LIMIT 1`,
        [res.body.user.id],
      );
      expect(row.token_hash).toBe(expectedHash);

      await dataSource.query('DELETE FROM auth_tokens WHERE user_id = $1', [res.body.user.id]);
      await dataSource.query('DELETE FROM communication_logs WHERE recipient_address = $1', [
        'invitee-e2e@example.com',
      ]);
      await dataSource.query('DELETE FROM user_tenants WHERE user_id = $1', [res.body.user.id]);
      await dataSource.query('DELETE FROM users WHERE id = $1', [res.body.user.id]);
    });

    // 401, not 403 — RolesGuard (context.guard.ts) throws UnauthorizedException
    // for every role mismatch app-wide, not just here; that's an existing,
    // systemic convention this test isn't the place to change.
    it('a TEACHER cannot resend an invitation (401)', async () => {
      // Reuse the teacher token minted in the boundaries suite above.
      const loginRes = await request()
        .post('/api/v1/auth/login')
        .send({ email: 'staff-a@example.com', password: SEED_ADMIN_PASSWORD })
        .expect(200);

      await request()
        .post(`/api/v1/users/${MEMBER_A_ID}/invitation/resend`)
        .set('Authorization', `Bearer ${loginRes.body.access_token}`)
        .set('X-Tenant-ID', TENANT_A)
        .expect(401);
    });

    it('resending an invitation for a tenant-B user from tenant A returns 404', async () => {
      await request()
        .post(`/api/v1/users/${MEMBER_B_ID}/invitation/resend`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_A)
        .expect(404);
    });
  });
});
