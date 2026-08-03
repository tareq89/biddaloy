import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { AuthService } from './auth.service';
import { DataSource } from 'typeorm';
import { SEED_TENANT_ID, SEED_ADMIN_EMAIL, SEED_ADMIN_USER_ID, SEED_ADMIN_PASSWORD } from '@test/constants';

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
    process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:***@localhost:5432/betonboi';
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
  });
});