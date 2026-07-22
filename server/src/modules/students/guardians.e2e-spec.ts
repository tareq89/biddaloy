import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from '../../app.module';
import { DataSource } from 'typeorm';
import { UserRole } from '@beton-boi/shared';
import { SEED_TENANT_ID, SEED_ADMIN_EMAIL, SEED_ADMIN_USER_ID, SEED_ADMIN_PASSWORD } from '@test/constants';

/**
 * E2E tests for Guardian endpoints.
 *
 * Tests CRUD operations for guardians, including linking
 * guardians to students, with tenant isolation and RBAC.
 */

describe('Guardians E2E', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let adminToken: string;
  let studentToken: string;

  const TENANT_ID = SEED_TENANT_ID;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:***@localhost:5432/betonboi';
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-production';
    process.env.NODE_ENV = 'test';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();

    dataSource = app.get(DataSource);

    const loginRes = await supertest(app.getHttpServer())
      .post('/auth/login')
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    adminToken = loginRes.body.access_token;

    // Give the seed admin a STUDENT membership too, so a single login can
    // carry both roles (selected via X-Role) for the RBAC denial matrix
    // below. Idempotent + parameterized (was previously raw string
    // interpolation — a SQL injection smell flagged in review).
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [SEED_ADMIN_USER_ID, TENANT_ID, UserRole.STUDENT],
    );
    const studentLoginRes = await supertest(app.getHttpServer())
      .post('/auth/login')
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    studentToken = studentLoginRes.body.access_token;
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  describe('POST /guardians', () => {
    it('should create a guardian with ADMIN role', async () => {
      const res = await supertest(app.getHttpServer())
        .post('/guardians')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({
          full_name: 'Parent One',
          relationship: 'Father',
          phone: '+8801712345678',
          email: 'parent@example.com',
        })
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.full_name).toBe('Parent One');
      expect(res.body.relationship).toBe('Father');
      expect(res.body.tenant_id).toBe(TENANT_ID);
    });

    it('should return 401 without X-Tenant-ID header', async () => {
      const res = await supertest(app.getHttpServer())
        .post('/guardians')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ full_name: 'No Tenant', relationship: 'Mother' })
        .expect(401);

      expect(res.body.message).toBe('X-Tenant-ID header is required');
    });

    it('should return 401 for STUDENT role', async () => {
      const res = await supertest(app.getHttpServer())
        .post('/guardians')
        .set('Authorization', `Bearer ${studentToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.STUDENT)
        .send({ full_name: 'Role Check', relationship: 'Guardian' })
        .expect(401);

      expect(res.body.message).toContain('Requires one of roles');
    });

    it('should return 400 for invalid DTO (missing required fields)', async () => {
      const res = await supertest(app.getHttpServer())
        .post('/guardians')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({})
        .expect(400);
    });
  });

  describe('GET /guardians', () => {
    it('should list guardians (searchable by name)', async () => {
      const res = await supertest(app.getHttpServer())
        .get('/guardians')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(200);

      expect(res.body.data).toBeDefined();
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.total).toBeDefined();
    });

    it('should return 401 for STUDENT role', async () => {
      const res = await supertest(app.getHttpServer())
        .get('/guardians')
        .set('Authorization', `Bearer ${studentToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.STUDENT)
        .expect(401);

      expect(res.body.message).toContain('Requires one of roles');
    });
  });

  describe('PATCH /guardians/:id', () => {
    it('should update a guardian', async () => {
      const createRes = await supertest(app.getHttpServer())
        .post('/guardians')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ full_name: 'Original Guardian', relationship: 'Father' })
        .expect(201);

      const res = await supertest(app.getHttpServer())
        .patch(`/guardians/${createRes.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ full_name: 'Updated Guardian', phone: '+8801711111111' })
        .expect(200);

      expect(res.body.full_name).toBe('Updated Guardian');
      expect(res.body.phone).toBe('+8801711111111');
    });

    it('should return 401 for STUDENT role on update', async () => {
      const createRes = await supertest(app.getHttpServer())
        .post('/guardians')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ full_name: 'Protected', relationship: 'Mother' })
        .expect(201);

      const res = await supertest(app.getHttpServer())
        .patch(`/guardians/${createRes.body.id}`)
        .set('Authorization', `Bearer ${studentToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.STUDENT)
        .send({ full_name: 'Should Not Update' })
        .expect(401);

      expect(res.body.message).toContain('Requires one of roles');
    });
  });

  describe('DELETE /guardians/:id', () => {
    it('should soft delete a guardian', async () => {
      const createRes = await supertest(app.getHttpServer())
        .post('/guardians')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ full_name: 'Delete Guardian', relationship: 'Father' })
        .expect(201);

      await supertest(app.getHttpServer())
        .delete(`/guardians/${createRes.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(200);

      // Verify not found by listing — the guardian should be soft-deleted
      const listRes = await supertest(app.getHttpServer())
        .get('/guardians')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(200);

      expect(listRes.body.data.find((g: any) => g.id === createRes.body.id)).toBeUndefined();
    });

    it('should return 401 for STUDENT role on delete', async () => {
      const createRes = await supertest(app.getHttpServer())
        .post('/guardians')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ full_name: 'Protected Guardian', relationship: 'Mother' })
        .expect(201);

      const res = await supertest(app.getHttpServer())
        .delete(`/guardians/${createRes.body.id}`)
        .set('Authorization', `Bearer ${studentToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.STUDENT)
        .expect(401);

      expect(res.body.message).toContain('Requires one of roles');
    });
  });
});