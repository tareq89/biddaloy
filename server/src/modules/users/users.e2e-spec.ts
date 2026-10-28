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

  describe('[12.7] PATCH /users/me no longer accepts email/phone', () => {
    it('rejects a body with email with 400 (forbidNonWhitelisted)', async () => {
      await request()
        .patch('/api/v1/users/me')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_A)
        .send({ email: 'new-address@example.com' })
        .expect(400);
    });

    it('rejects a body with phone with 400 (forbidNonWhitelisted)', async () => {
      await request()
        .patch('/api/v1/users/me')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_A)
        .send({ phone: '+8801799999999' })
        .expect(400);
    });

    it('still accepts full_name', async () => {
      const before = await dataSource.query(`SELECT full_name FROM users WHERE id = $1`, [
        SEED_ADMIN_USER_ID,
      ]);
      const originalName = before[0].full_name as string;

      const res = await request()
        .patch('/api/v1/users/me')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_A)
        .send({ full_name: 'Renamed Admin' })
        .expect(200);
      expect(res.body.full_name).toBe('Renamed Admin');

      // Restore, so later tests relying on the seed admin's name are unaffected.
      await dataSource.query(`UPDATE users SET full_name = $2 WHERE id = $1`, [
        SEED_ADMIN_USER_ID,
        originalName,
      ]);
    });
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

      // Membership row soft-deleted (a former member, restorable) [13.2.1]…
      const memberships = await dataSource.query(
        'SELECT deleted_at FROM user_tenants WHERE user_id = $1 AND tenant_id = $2',
        [MEMBER_A_ID, TENANT_A],
      );
      expect(memberships).toHaveLength(1);
      expect(memberships[0].deleted_at).not.toBeNull();

      // …but the global account survives, undeleted.
      const [row] = await dataSource.query('SELECT deleted_at FROM users WHERE id = $1', [
        MEMBER_A_ID,
      ]);
      expect(row).toBeDefined();
      expect(row.deleted_at).toBeNull();
    });
  });

  describe('GET /audit-logs (performed_by_user_id filter)', () => {
    // The seed admin also belongs to TENANT_B in this suite, so a login is a
    // platform-level audit row (tenant_id NULL, D28 / #2302) and is invisible
    // to the tenant-scoped audit screen. Write a tenant-A row directly.
    const writeTenantAuditRow = () =>
      dataSource.query(
        `INSERT INTO audit_logs (tenant_id, action, entity_type, performed_by_user_id)
         VALUES ($1, 'LOGIN', 'User', $2)`,
        [TENANT_A, SEED_ADMIN_USER_ID],
      );

    it('returns only rows performed by the given user', async () => {
      // audit_logs is truncated before every test (test/setup.ts), so the
      // beforeAll login's row is gone — write a fresh LOGIN row here.
      await writeTenantAuditRow();

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
      await writeTenantAuditRow();

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
    let accountantToken: string;
    const ACCOUNTANT_ID = '00000000-0000-4000-8000-000000000214';

    afterAll(async () => {
      await dataSource
        .query('DELETE FROM auth_tokens WHERE user_id = $1', [ACCOUNTANT_ID])
        .catch(() => {});
      await dataSource.query('DELETE FROM user_tenants WHERE user_id = $1', [ACCOUNTANT_ID]);
      await dataSource.query('DELETE FROM users WHERE id = $1', [ACCOUNTANT_ID]);
    });

    beforeAll(async () => {
      // #2327 step 6: ACCOUNTANT is the staff role that could plausibly gain USER_CREATE later.
      await dataSource.query(
        `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
         VALUES ($1, 'accountant-a@example.com', $2, 'Akhi TenantA Accountant', 'ACTIVE', NOW(), NOW())
         ON CONFLICT (id) DO NOTHING`,
        [ACCOUNTANT_ID, SEED_ADMIN_PASSWORD_HASH],
      );
      await dataSource.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [ACCOUNTANT_ID, TENANT_A, UserRole.ACCOUNTANT],
      );
      accountantToken = (
        await request()
          .post('/api/v1/auth/login')
          .send({ email: 'accountant-a@example.com', password: SEED_ADMIN_PASSWORD })
          .expect(200)
      ).body.access_token;
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
      // [13.2.1] removal is a soft delete, so the insert above conflicts with
      // the former row; bring that row back.
      await dataSource.query(
        'UPDATE user_tenants SET deleted_at = NULL WHERE user_id = $1 AND tenant_id = $2',
        [MEMBER_A_ID, TENANT_A],
      );
      const res = await request()
        .post('/api/v1/auth/login')
        .send({ email: 'staff-a@example.com', password: SEED_ADMIN_PASSWORD })
        .expect(200);
      teacherToken = res.body.access_token;
    });

    it('[#731] rejects an ADMIN minting a SUPER_ADMIN membership with 400', async () => {
      const email = 'escalate-731@example.com';
      const res = await request()
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_A)
        .send({ email, tenantId: TENANT_A, full_name: 'Escalator', role: UserRole.SUPER_ADMIN })
        .expect(400);
      expect(res.body.message).toContain('SUPER_ADMIN');
      const rows = await dataSource.query('SELECT id FROM users WHERE email = $1', [email]);
      expect(rows).toHaveLength(0);
    });

    it('[#731] PATCH /users/:id cannot carry a role (400 forbidNonWhitelisted)', async () => {
      await request()
        .patch(`/api/v1/users/${MEMBER_A_ID}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_A)
        .send({ role: UserRole.SUPER_ADMIN })
        .expect(400);
      const rows = await dataSource.query(
        'SELECT 1 FROM user_tenants WHERE user_id = $1 AND role = $2',
        [MEMBER_A_ID, UserRole.SUPER_ADMIN],
      );
      expect(rows).toHaveLength(0);
    });

    it('[#731] still creates a normal-role user', async () => {
      const email = 'ok-731@example.com';
      const res = await request()
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_A)
        .send({ email, tenantId: TENANT_A, full_name: 'Fine Teacher', role: UserRole.TEACHER })
        .expect(201);
      expect(res.body.user.role).toBe(UserRole.TEACHER);
      const id = res.body.user.id;
      await dataSource.query('DELETE FROM auth_tokens WHERE user_id = $1', [id]).catch(() => {});
      await dataSource.query('DELETE FROM user_tenants WHERE user_id = $1', [id]);
      await dataSource.query('DELETE FROM users WHERE id = $1', [id]);
    });

    it('[75.19] a duplicate email 409s without repeating the address', async () => {
      const email = 'dup-7519@example.com';
      const create = () =>
        request()
          .post('/api/v1/users')
          .set('Authorization', `Bearer ${adminToken}`)
          .set('X-Tenant-ID', TENANT_A)
          .send({ email, full_name: 'Dup One', role: UserRole.TEACHER });
      const first = await create().expect(201);
      const res = await create().expect(409);
      expect(JSON.stringify(res.body)).not.toContain(email);
      // [68.2.02] The UI keys its "Send join request" offer on this code.
      expect(res.body.details).toMatchObject({ code: 'ACCOUNT_EXISTS' });
      const id = first.body.user.id;
      await dataSource.query('DELETE FROM auth_tokens WHERE user_id = $1', [id]).catch(() => {});
      await dataSource.query('DELETE FROM user_tenants WHERE user_id = $1', [id]);
      await dataSource.query('DELETE FROM users WHERE id = $1', [id]);
    });

    it('[#2864] a passwordless user with no email and no phone is a 400 CONTACT_REQUIRED, nothing saved', async () => {
      const name = 'Contactless 2864';
      const res = await request()
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_A)
        .send({ full_name: name, role: UserRole.TEACHER })
        .expect(400);
      expect(res.body.details).toMatchObject({ code: 'CONTACT_REQUIRED' });
      const rows = await dataSource.query('SELECT id FROM users WHERE full_name = $1', [name]);
      expect(rows).toHaveLength(0);
    });

    it('[#2864] promoting someone who already has a teacher profile is a 409 without their id', async () => {
      const promote = (employee_id: string) =>
        request()
          .post('/api/v1/teachers')
          .set('Authorization', `Bearer ${adminToken}`)
          .set('X-Tenant-ID', TENANT_A)
          .send({ user_id: MEMBER_A_ID, employee_id });
      // First call may 201 or (if an earlier case promoted member A) already 409.
      await promote('E2E-2864-A');
      const res = await promote('E2E-2864-B').expect(409);
      expect(res.body.details).toMatchObject({ code: 'ALREADY_TEACHER_HERE' });
      expect(JSON.stringify(res.body)).not.toContain(MEMBER_A_ID);
    });

    it("[Rule 23] promoting another school's member answers exactly like an unknown id", async () => {
      const promote = (user_id: string) =>
        request()
          .post('/api/v1/teachers')
          .set('Authorization', `Bearer ${adminToken}`)
          .set('X-Tenant-ID', TENANT_A)
          .send({ user_id, employee_id: 'E2E-R23' });
      // MEMBER_B is a real account, but only in school B.
      const otherSchool = await promote(MEMBER_B_ID).expect(404);
      const unknown = await promote('00000000-0000-4000-8000-0000000009ff').expect(404);
      expect(otherSchool.body.message).toBe(unknown.body.message);
    });

    describe('[68.2.02] POST /users/join-requests', () => {
      const send = (token: string, body: object, tenant: string | null = TENANT_A) => {
        const r = request()
          .post('/api/v1/users/join-requests')
          .set('Authorization', `Bearer ${token}`);
        return (tenant ? r.set('X-Tenant-ID', tenant) : r).send(body);
      };
      const body = { email: 'nobody-6822@example.com', role: UserRole.ACCOUNTANT };

      it('ADMIN gets 202 PENDING (a miss answers like a hit)', async () => {
        const res = await send(adminToken, body).expect(202);
        expect(res.body).toEqual({ status: 'PENDING' });
      });

      it('TEACHER gets 403', async () => {
        await send(teacherToken, body).expect(403);
      });

      it('missing X-Tenant-ID gets 401', async () => {
        await send(adminToken, body, null).expect(401);
      });

      it.each([UserRole.SUPER_ADMIN, UserRole.PARENT, UserRole.STUDENT])(
        'role %s gets 400',
        async (role) => {
          await send(adminToken, { ...body, role }).expect(400);
        },
      );

      it('neither email nor phone gets 400', async () => {
        await send(adminToken, { role: UserRole.ACCOUNTANT }).expect(400);
      });
    });

    it('[75.19] ignores a tenantId in the body: the membership is in X-Tenant-ID only', async () => {
      const email = 'tenantid-7519@example.com';
      const res = await request()
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_A)
        .send({
          email,
          tenantId: '00000000-0000-4000-8000-0000000000bb',
          full_name: 'Ignored Tenant',
          role: UserRole.ADMIN,
        })
        .expect(201);
      const id = res.body.user.id;
      const rows = await dataSource.query('SELECT tenant_id FROM user_tenants WHERE user_id = $1', [
        id,
      ]);
      expect(rows.map((r: { tenant_id: string }) => r.tenant_id)).toEqual([TENANT_A]);
      await dataSource.query('DELETE FROM auth_tokens WHERE user_id = $1', [id]).catch(() => {});
      await dataSource.query('DELETE FROM user_tenants WHERE user_id = $1', [id]);
      await dataSource.query('DELETE FROM users WHERE id = $1', [id]);
    });

    it('[75.19] denies an ACCOUNTANT creating an ADMIN', async () => {
      await request()
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${accountantToken}`)
        .set('X-Tenant-ID', TENANT_A)
        .send({ email: 'nope-7519@example.com', full_name: 'Nope', role: UserRole.ADMIN })
        .expect(403);
    });

    it('denies a TEACHER creating a user (ADMIN/EXECUTIVE only)', async () => {
      const res = await request()
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${teacherToken}`)
        .set('X-Tenant-ID', TENANT_A)
        .send({ full_name: 'Should Not Exist', role: UserRole.TEACHER })
        .expect(403);
      expect(res.body.message).toContain('Requires permission(s)');
    });

    it('denies a TEACHER removing a member (ADMIN only)', async () => {
      const res = await request()
        .delete(`/api/v1/users/${MEMBER_A_ID}`)
        .set('Authorization', `Bearer ${teacherToken}`)
        .set('X-Tenant-ID', TENANT_A)
        .expect(403);
      expect(res.body.message).toContain('Requires permission(s)');
    });

    it('denies a TEACHER reading audit logs (ADMIN only)', async () => {
      const res = await request()
        .get('/api/v1/audit-logs')
        .set('Authorization', `Bearer ${teacherToken}`)
        .set('X-Tenant-ID', TENANT_A)
        .expect(403);
      expect(res.body.message).toContain('Requires permission(s)');
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

    it('a TEACHER cannot resend an invitation (403)', async () => {
      // Reuse the teacher token minted in the boundaries suite above.
      const loginRes = await request()
        .post('/api/v1/auth/login')
        .send({ email: 'staff-a@example.com', password: SEED_ADMIN_PASSWORD })
        .expect(200);

      await request()
        .post(`/api/v1/users/${MEMBER_A_ID}/invitation/resend`)
        .set('Authorization', `Bearer ${loginRes.body.access_token}`)
        .set('X-Tenant-ID', TENANT_A)
        .expect(403);
    });

    it('resending an invitation for a tenant-B user from tenant A returns 404', async () => {
      await request()
        .post(`/api/v1/users/${MEMBER_B_ID}/invitation/resend`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_A)
        .expect(404);
    });
  });

  describe('[67.5.03] /users/me/preferences/notifications', () => {
    const PATH = '/api/v1/users/me/preferences/notifications';
    const PARENT_ID = '00000000-0000-4000-8000-000000000213';
    let teacherToken: string;
    let parentToken: string;

    const login = async (email: string) =>
      (
        await request()
          .post('/api/v1/auth/login')
          .send({ email, password: SEED_ADMIN_PASSWORD })
          .expect(200)
      ).body.access_token as string;
    const prefsOf = async (id: string) =>
      (await dataSource.query(`SELECT preferences FROM users WHERE id = $1`, [id]))[0].preferences;

    beforeAll(async () => {
      await dataSource.query(
        `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
         VALUES ($1, 'parent-prefs@example.com', $2, 'Prefs Parent', 'ACTIVE', NOW(), NOW())
         ON CONFLICT (id) DO NOTHING`,
        [PARENT_ID, SEED_ADMIN_PASSWORD_HASH],
      );
      await dataSource.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [PARENT_ID, TENANT_A, UserRole.PARENT],
      );
      teacherToken = await login('staff-a@example.com');
      parentToken = await login('parent-prefs@example.com');
    });

    afterAll(async () => {
      await dataSource.query('DELETE FROM user_tenants WHERE user_id = $1', [PARENT_ID]);
      await dataSource.query('DELETE FROM users WHERE id = $1', [PARENT_ID]);
    });

    const call = (method: 'get' | 'patch', token: string) =>
      request()[method](PATH).set('Authorization', `Bearer ${token}`).set('X-Tenant-ID', TENANT_A);

    it('TEACHER and PARENT can read and change only their own mute', async () => {
      const other = await prefsOf(MEMBER_B_ID);

      const t = await call('patch', teacherToken)
        .send({ mutedCategories: ['HOMEWORK'] })
        .expect(200);
      expect(t.body.mutedCategories).toEqual(['HOMEWORK']);
      expect(t.body.quietHours).toEqual({ start: '21:00', end: '07:00' });

      await call('patch', parentToken)
        .send({ mutedCategories: ['FEES', 'COMMON'] })
        .expect(200);

      expect((await call('get', teacherToken).expect(200)).body.mutedCategories).toEqual([
        'HOMEWORK',
      ]);
      expect((await call('get', parentToken).expect(200)).body.mutedCategories).toEqual([
        'FEES',
        'COMMON',
      ]);
      // Nobody else's row moved.
      expect(await prefsOf(MEMBER_B_ID)).toEqual(other);
    });

    it('GET /users/me still returns preferences including the new key', async () => {
      const res = await request()
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${teacherToken}`)
        .set('X-Tenant-ID', TENANT_A)
        .expect(200);
      expect(res.body.preferences?.notifications?.mutedCategories).toEqual(['HOMEWORK']);
    });

    it.each([
      ['unknown category', { mutedCategories: ['NOPE'] }],
      ['more than 16 items', { mutedCategories: Array(17).fill('FEES') }],
      ['extra key', { mutedCategories: [], userId: MEMBER_B_ID }],
      ['duplicates', { mutedCategories: ['FEES', 'FEES'] }],
    ])('rejects %s with 400', async (_name, body) => {
      await call('patch', teacherToken).send(body).expect(400);
    });

    it('rejects a missing X-Tenant-ID', async () => {
      const res = await request().get(PATH).set('Authorization', `Bearer ${teacherToken}`);
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    });
  });
});
