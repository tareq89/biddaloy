import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import cookieParser = require('cookie-parser');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { AuthService } from './auth.service';
import { DataSource } from 'typeorm';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_USER_ID,
  SEED_ADMIN_PASSWORD,
} from '@test/constants';

function extractSetCookieHeaders(res: supertest.Response): string[] {
  return (res.headers['set-cookie'] as unknown as string[] | undefined) ?? [];
}

function extractRefreshCookie(res: supertest.Response): string {
  const header = extractSetCookieHeaders(res).find((c) => c.startsWith('__Host-refresh_token='));
  if (!header) throw new Error('No refresh_token cookie was set on this response');
  const match = header.match(/^__Host-refresh_token=([^;]+)/);
  return decodeURIComponent(match![1]);
}

async function loginAsSeedAdmin(app: INestApplication): Promise<supertest.Response> {
  return supertest(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email: SEED_ADMIN_EMAIL, password: 'password123' })
    .expect(200);
}

/**
 * E2E tests for Auth endpoints.
 *
 * Tests login flow, JWT generation, and tenant context.
 * These tests run against a real database with the full NestJS app.
 */

describe('Auth E2E', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  beforeAll(async () => {
    // Ensure test database is used
    process.env.DATABASE_URL =
      process.env.DATABASE_URL || 'postgres://postgres:***@localhost:5432/biddaloy';
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-production';
    process.env.NODE_ENV = 'test';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    // Force eager creation of AuthService before app.init() so the
    // AuthController receives the injected service rather than undefined.
    // This works around a NestJS lazy-initialization edge case where the
    // AuthService (which depends on TypeORM repositories + JwtService via
    // ConfigService) is not created during app.init().
    moduleFixture.get(AuthService);

    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    // bootstrap() never runs under the Nest testing harness (see
    // configureApiVersioning's comment) — the refresh/logout endpoints
    // need this to read the httpOnly refresh_token cookie.
    app.use(cookieParser());
    await app.init();

    dataSource = app.get(DataSource);
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  describe('POST /auth/login', () => {
    it('should return 200 and a JWT token for valid credentials', async () => {
      // Use the seed admin credentials
      const res = await supertest(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: SEED_ADMIN_EMAIL, password: 'password123' })
        .expect(200);

      expect(res.body.access_token).toBeDefined();
      expect(typeof res.body.access_token).toBe('string');
      expect(res.body.memberships).toBeDefined();
      expect(Array.isArray(res.body.memberships)).toBe(true);
    });

    it('should return 401 for invalid credentials', async () => {
      const res = await supertest(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: SEED_ADMIN_EMAIL, password: 'wrongpassword' })
        .expect(401);

      expect(res.body.message).toBe('Invalid credentials');
    });

    it('should return 401 for non-existent user', async () => {
      const res = await supertest(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'nonexistent@test.com', password: SEED_ADMIN_PASSWORD })
        .expect(401);

      expect(res.body.message).toBe('Invalid credentials');
    });

    it('should return 400, not 500, when neither email nor phone is supplied', async () => {
      const res = await supertest(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ password: 'password123' })
        .expect(400);

      expect(res.body.message).toContain('Either email or phone is required');
    });

    it('should return 400 for an unknown extra field (strict whitelist)', async () => {
      const res = await supertest(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: SEED_ADMIN_EMAIL, password: 'password123', role: 'SUPER_ADMIN' })
        .expect(400);

      expect(res.body.message).toBeDefined();
    });

    it('should write a LOGIN audit row on success', async () => {
      await supertest(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: SEED_ADMIN_EMAIL, password: 'password123' })
        .expect(200);

      const rows = await dataSource.query(
        `SELECT * FROM "audit_logs" WHERE action = 'LOGIN' AND performed_by_user_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [SEED_ADMIN_USER_ID],
      );

      expect(rows).toHaveLength(1);
    });

    it('should write a LOGIN_FAILED audit row on a wrong password', async () => {
      await supertest(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: SEED_ADMIN_EMAIL, password: 'wrongpassword' })
        .expect(401);

      // entity_id/performed_by_user_id are null on this row by design (see
      // AuthService.writeAuditLog), so scope by the identifier instead of
      // relying on recency alone — otherwise a LOGIN_FAILED row from a
      // concurrently running e2e file against the shared test database
      // could make this flaky.
      const rows = await dataSource.query(
        `SELECT * FROM "audit_logs" WHERE action = 'LOGIN_FAILED' AND new_values->>'identifier' = $1 ORDER BY created_at DESC LIMIT 1`,
        [SEED_ADMIN_EMAIL.toLowerCase()],
      );

      expect(rows).toHaveLength(1);
      expect(rows[0].new_values).toEqual({ identifier: SEED_ADMIN_EMAIL.toLowerCase() });
    });

    it('sets a __Host-prefixed httpOnly refresh cookie with the attributes the prefix requires', async () => {
      const res = await loginAsSeedAdmin(app);

      const header = extractSetCookieHeaders(res).find((c) =>
        c.startsWith('__Host-refresh_token='),
      );
      expect(header).toBeDefined();
      expect(header).toContain('HttpOnly');
      expect(header).toContain('Path=/');
      expect(header).toContain('SameSite=Strict');
      // __Host- mandates Secure unconditionally, even outside production —
      // see token-cookie.ts.
      expect(header).toContain('Secure');
      expect(header).not.toContain('Domain=');
    });
  });

  describe('POST /auth/refresh', () => {
    it('rotates the cookie and issues a fresh access token', async () => {
      const loginRes = await loginAsSeedAdmin(app);
      const cookie = extractRefreshCookie(loginRes);

      const res = await supertest(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', `__Host-refresh_token=${cookie}`)
        .expect(200);

      expect(res.body.access_token).toBeDefined();
      expect(res.body.access_token).not.toBe(loginRes.body.access_token);
      expect(extractRefreshCookie(res)).not.toBe(cookie);
    });

    it('returns 401 when no cookie is presented', async () => {
      await supertest(app.getHttpServer()).post('/api/v1/auth/refresh').expect(401);
    });

    // Defense-in-depth against CSRF (issue #48) — SameOriginGuard rejects a
    // mismatched Origin header before the cookie is even looked at.
    it('rejects a mismatched Origin header', async () => {
      await supertest(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Origin', 'https://evil.example.com')
        .expect(403);
    });

    it('allows a same-origin request that carries an Origin header', async () => {
      const loginRes = await loginAsSeedAdmin(app);
      const cookie = extractRefreshCookie(loginRes);

      // supertest spins up its own ephemeral server per call and tears it
      // down immediately after, so its real port can't be read reliably —
      // overriding the Host header to a fixed value and matching it in
      // Origin sidesteps that: SameOriginGuard only ever compares these two
      // headers against each other, not against anything external.
      await supertest(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', `__Host-refresh_token=${cookie}`)
        .set('Host', 'app.example.com')
        .set('Origin', 'http://app.example.com')
        .expect(200);
    });

    it('returns 401 for a well-formed but unknown cookie value', async () => {
      await supertest(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', `__Host-refresh_token=${'0'.repeat(36)}.${'a'.repeat(64)}`)
        .expect(401);
    });

    it('returns 401 for a garbage cookie value with no separator', async () => {
      await supertest(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', '__Host-refresh_token=garbage')
        .expect(401);
    });

    // The concrete scenario #42 called "the sharpest edge" of the old
    // 7-day token: a role/tenant revocation now takes effect within one
    // refresh, not up to 7 days later — refresh must re-fetch memberships
    // rather than copy them from the token being replaced.
    it('reflects membership changes made since the token was issued', async () => {
      const loginRes = await loginAsSeedAdmin(app);
      const cookie = extractRefreshCookie(loginRes);

      const newRole = await dataSource.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role) VALUES ($1, $2, 'TEACHER') RETURNING id`,
        [SEED_ADMIN_USER_ID, SEED_TENANT_ID],
      );

      try {
        const res = await supertest(app.getHttpServer())
          .post('/api/v1/auth/refresh')
          .set('Cookie', `__Host-refresh_token=${cookie}`)
          .expect(200);

        expect(res.body.memberships).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ tenantId: SEED_TENANT_ID, role: 'TEACHER' }),
          ]),
        );
      } finally {
        await dataSource.query(`DELETE FROM user_tenants WHERE id = $1`, [newRole[0].id]);
      }
    });

    it('rejects reuse of an already-rotated token outside the grace window and revokes the whole family', async () => {
      const loginRes = await loginAsSeedAdmin(app);
      const firstCookie = extractRefreshCookie(loginRes);
      const [firstId] = firstCookie.split('.');

      const rotatedRes = await supertest(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', `__Host-refresh_token=${firstCookie}`)
        .expect(200);
      const rotatedCookie = extractRefreshCookie(rotatedRes);

      // Simulate the concurrent-refresh grace window having elapsed —
      // the unit tests (refresh-token.service.spec.ts) already cover the
      // within-grace race behavior directly; this exercises the theft path
      // end to end against real Postgres.
      await dataSource.query(
        `UPDATE refresh_tokens SET revoked_at = NOW() - INTERVAL '1 minute' WHERE id = $1`,
        [firstId],
      );

      await supertest(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', `__Host-refresh_token=${firstCookie}`)
        .expect(401);

      // The whole family is revoked, including the token issued by the
      // rotation above — not just the replayed one.
      await supertest(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', `__Host-refresh_token=${rotatedCookie}`)
        .expect(401);

      const rows = await dataSource.query(
        `SELECT * FROM audit_logs WHERE action = 'TOKEN_REUSE_DETECTED' AND performed_by_user_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [SEED_ADMIN_USER_ID],
      );
      expect(rows).toHaveLength(1);
    });
  });

  describe('POST /auth/logout', () => {
    it('revokes the refresh cookie, clears it, and writes a LOGOUT audit row', async () => {
      const loginRes = await loginAsSeedAdmin(app);
      const cookie = extractRefreshCookie(loginRes);

      const res = await supertest(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('Cookie', `__Host-refresh_token=${cookie}`)
        .expect(204);

      const clearHeader = extractSetCookieHeaders(res).find((c) =>
        c.startsWith('__Host-refresh_token='),
      );
      expect(clearHeader).toContain('__Host-refresh_token=;');

      await supertest(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', `__Host-refresh_token=${cookie}`)
        .expect(401);

      const rows = await dataSource.query(
        `SELECT * FROM audit_logs WHERE action = 'LOGOUT' AND performed_by_user_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [SEED_ADMIN_USER_ID],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].new_values).toBeNull();
    });

    it('is a no-op success when no cookie is presented — nothing to revoke either way', async () => {
      await supertest(app.getHttpServer()).post('/api/v1/auth/logout').expect(204);
    });

    it('rejects a mismatched Origin header', async () => {
      await supertest(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('Origin', 'https://evil.example.com')
        .expect(403);
    });
  });

  describe('POST /auth/logout-all', () => {
    it('requires authentication', async () => {
      await supertest(app.getHttpServer()).post('/api/v1/auth/logout-all').expect(401);
    });

    it('revokes every refresh token and denylists the access token used to call it', async () => {
      const loginRes = await loginAsSeedAdmin(app);
      const accessToken = loginRes.body.access_token as string;
      const cookie = extractRefreshCookie(loginRes);

      await supertest(app.getHttpServer())
        .post('/api/v1/auth/logout-all')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(204);

      // The refresh token is revoked immediately.
      await supertest(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', `__Host-refresh_token=${cookie}`)
        .expect(401);

      // So is the access token used to call logout-all itself — it doesn't
      // have to wait out its own ~15 minute natural expiry.
      await supertest(app.getHttpServer())
        .post('/api/v1/auth/logout-all')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(401);

      const rows = await dataSource.query(
        `SELECT * FROM audit_logs WHERE action = 'LOGOUT' AND performed_by_user_id = $1 AND new_values->>'scope' = 'all_sessions' ORDER BY created_at DESC LIMIT 1`,
        [SEED_ADMIN_USER_ID],
      );
      expect(rows).toHaveLength(1);
    });
  });
});
