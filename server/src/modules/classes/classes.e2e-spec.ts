import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from '../../app.module';
import { DataSource } from 'typeorm';
import { UserRole } from '@beton-boi/shared';
import { SEED_TENANT_ID, SEED_ADMIN_EMAIL, SEED_ADMIN_USER_ID, SEED_ACADEMIC_YEAR_ID, SEED_ADMIN_PASSWORD } from '@test/constants';

/**
 * E2E tests for Class & Section endpoints.
 *
 * Tests nested CRUD operations: classes under an academic year,
 * sections under a class, with tenant isolation and RBAC.
 */

describe('Classes & Sections E2E', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let adminToken: string;

  const TENANT_ID = SEED_TENANT_ID;

  beforeAll(async () => {
    console.log('[classes.e2e] beforeAll called');
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
      .send({ email: SEED_ADMIN_EMAIL, password: 'password123' })
      .expect(200);
    adminToken = loginRes.body.access_token;
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  describe('POST /classes', () => {
    it('should create a class under an academic year (ADMIN role)', async () => {
      const res = await supertest(app.getHttpServer())
        .post('/classes')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ name: 'Class One', academic_year_id: SEED_ACADEMIC_YEAR_ID })
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.name).toBe('Class One');
      expect(res.body.tenant_id).toBe(TENANT_ID);
    });

    it('should return 401 without X-Tenant-ID header', async () => {
      const res = await supertest(app.getHttpServer())
        .post('/classes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'No Tenant', academic_year_id: SEED_ACADEMIC_YEAR_ID })
        .expect(401);

      expect(res.body.message).toBe('X-Tenant-ID header is required');
    });

    it('should return 403 for STUDENT role', async () => {
      // Insert STUDENT role for the user
      await dataSource.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ('${SEED_ADMIN_USER_ID}', '${TENANT_ID}', '${UserRole.STUDENT}', NOW(), NOW())
         ON CONFLICT DO NOTHING`,
      );

      // Get a new token with the STUDENT role included
      const loginRes = await supertest(app.getHttpServer())
        .post('/auth/login')
        .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
        .expect(200);
      const studentToken = loginRes.body.access_token;

      const res = await supertest(app.getHttpServer())
        .post('/classes')
        .set('Authorization', `Bearer ${studentToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.STUDENT)
        .send({ name: 'Role Check', academic_year_id: SEED_ACADEMIC_YEAR_ID })
        .expect(401);

      expect(res.body.message).toContain('Requires one of roles');
    });

    it('should return 400 for invalid DTO (missing required fields)', async () => {
      const res = await supertest(app.getHttpServer())
        .post('/classes')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({})
        .expect(400);
    });
  });

  describe('GET /classes', () => {
    it('should list classes (filter by academic_year_id)', async () => {
      const res = await supertest(app.getHttpServer())
        .get('/classes')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .query({ academic_year_id: SEED_ACADEMIC_YEAR_ID })
        .expect(200);

      expect(res.body.data).toBeDefined();
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.total).toBeDefined();
    });
  });

  describe('GET /classes/:id', () => {
    it('should return a class by ID', async () => {
      const createRes = await supertest(app.getHttpServer())
        .post('/classes')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ name: 'Find Class', academic_year_id: SEED_ACADEMIC_YEAR_ID })
        .expect(201);

      const res = await supertest(app.getHttpServer())
        .get(`/classes/${createRes.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(200);

      expect(res.body.id).toBe(createRes.body.id);
      expect(res.body.name).toBe('Find Class');
    });

    it('should return 404 for a non-existent class', async () => {
      const res = await supertest(app.getHttpServer())
        .get('/classes/00000000-0000-4000-8000-000000000000')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(404);
    });
  });

  describe('PATCH /classes/:id', () => {
    it('should update a class', async () => {
      const createRes = await supertest(app.getHttpServer())
        .post('/classes')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ name: 'Original', academic_year_id: SEED_ACADEMIC_YEAR_ID })
        .expect(201);

      const res = await supertest(app.getHttpServer())
        .patch(`/classes/${createRes.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ name: 'Updated Class' })
        .expect(200);

      expect(res.body.name).toBe('Updated Class');
    });
  });

  describe('DELETE /classes/:id', () => {
    it('should delete a class', async () => {
      const createRes = await supertest(app.getHttpServer())
        .post('/classes')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ name: 'Delete Class', academic_year_id: SEED_ACADEMIC_YEAR_ID })
        .expect(201);

      await supertest(app.getHttpServer())
        .delete(`/classes/${createRes.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(200);

      // Verify not found
      await supertest(app.getHttpServer())
        .get(`/classes/${createRes.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(404);
    });
  });

  describe('POST /classes/:classId/sections', () => {
    it('should create a section under a class', async () => {
      const classRes = await supertest(app.getHttpServer())
        .post('/classes')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ name: 'Section Parent', academic_year_id: SEED_ACADEMIC_YEAR_ID })
        .expect(201);

      const res = await supertest(app.getHttpServer())
        .post(`/classes/${classRes.body.id}/sections`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ section_name: 'A', capacity: 30 })
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.section_name).toBe('A');
      expect(res.body.capacity).toBe(30);
      expect(res.body.tenant_id).toBe(TENANT_ID);
    });

    it('should return 400 for invalid DTO (missing section_name)', async () => {
      const classRes = await supertest(app.getHttpServer())
        .post('/classes')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ name: 'Section DTO Test', academic_year_id: SEED_ACADEMIC_YEAR_ID })
        .expect(201);

      const res = await supertest(app.getHttpServer())
        .post(`/classes/${classRes.body.id}/sections`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({})
        .expect(400);
    });
  });

  describe('GET /classes/:classId/sections', () => {
    it('should list sections of a class', async () => {
      const classRes = await supertest(app.getHttpServer())
        .post('/classes')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ name: 'List Sections', academic_year_id: SEED_ACADEMIC_YEAR_ID })
        .expect(201);

      // Create a section first
      await supertest(app.getHttpServer())
        .post(`/classes/${classRes.body.id}/sections`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ section_name: 'B', capacity: 25 })
        .expect(201);

      const res = await supertest(app.getHttpServer())
        .get(`/classes/${classRes.body.id}/sections`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('PATCH /classes/:classId/sections/:sectionId', () => {
    it('should update a section', async () => {
      const classRes = await supertest(app.getHttpServer())
        .post('/classes')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ name: 'Update Section', academic_year_id: SEED_ACADEMIC_YEAR_ID })
        .expect(201);

      const sectionRes = await supertest(app.getHttpServer())
        .post(`/classes/${classRes.body.id}/sections`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ section_name: 'C', capacity: 20 })
        .expect(201);

      const res = await supertest(app.getHttpServer())
        .patch(`/classes/${classRes.body.id}/sections/${sectionRes.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ section_name: 'C-Updated', capacity: 35 })
        .expect(200);

      expect(res.body.section_name).toBe('C-Updated');
      expect(res.body.capacity).toBe(35);
    });
  });

  describe('DELETE /classes/:classId/sections/:sectionId', () => {
    it('should delete a section', async () => {
      const classRes = await supertest(app.getHttpServer())
        .post('/classes')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ name: 'Delete Section', academic_year_id: SEED_ACADEMIC_YEAR_ID })
        .expect(201);

      const sectionRes = await supertest(app.getHttpServer())
        .post(`/classes/${classRes.body.id}/sections`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ section_name: 'D' })
        .expect(201);

      await supertest(app.getHttpServer())
        .delete(`/classes/${classRes.body.id}/sections/${sectionRes.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(200);

      // Verify section is gone
      const listRes = await supertest(app.getHttpServer())
        .get(`/classes/${classRes.body.id}/sections`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(200);

      expect(listRes.body.find((s: any) => s.id === sectionRes.body.id)).toBeUndefined();
    });
  });
});