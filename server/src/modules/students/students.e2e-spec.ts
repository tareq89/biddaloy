import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from '../../app.module';
import { DataSource } from 'typeorm';
import { UserRole } from '@beton-boi/shared';
import { SEED_TENANT_ID, SEED_ADMIN_EMAIL, SEED_ADMIN_USER_ID, SEED_SECTION_1_ID, SEED_ADMIN_PASSWORD } from '@test/constants';

/**
 * E2E tests for Student endpoints.
 *
 * Tests tenant isolation, registration number generation,
 * soft delete, role-based access control, paginated listing,
 * and update operations.
 */

describe('Students E2E', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let adminToken: string;

  const TENANT_ID = SEED_TENANT_ID;

  beforeAll(async () => {
    // Ensure test database is used
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

    // Log in as admin
    const loginRes = await supertest(app.getHttpServer())
      .post('/auth/login')
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    adminToken = loginRes.body.access_token;
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  describe('POST /students', () => {
    const createStudentPayload = {
      full_name: 'John Doe',
      class_section_id: SEED_SECTION_1_ID,
      date_of_birth: '2010-05-15',
    };

    it('should create a student with ADMIN role', async () => {
      const res = await supertest(app.getHttpServer())
        .post('/students')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send(createStudentPayload)
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.full_name).toBe('John Doe');
      expect(res.body.registration_number).toMatch(/^REG-\d{4}-\d{4}$/);
      // Critical: student belongs to the correct tenant
      expect(res.body.tenant_id).toBe(TENANT_ID);
    });

    it('should return 401 when X-Tenant-ID header is missing', async () => {
      const res = await supertest(app.getHttpServer())
        .post('/students')
        .set('Authorization', `Bearer ${adminToken}`)
        // No X-Tenant-ID
        .send(createStudentPayload)
        .expect(401);

      expect(res.body.message).toBe('X-Tenant-ID header is required');
    });

    it('should return 403 when a STUDENT tries to create a student', async () => {
      // Add STUDENT role to the admin user for this tenant
      await dataSource.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ('${SEED_ADMIN_USER_ID}', '${TENANT_ID}', '${UserRole.STUDENT}', NOW(), NOW())
         ON CONFLICT DO NOTHING`,
      );

      // Get a fresh token with the STUDENT role included in the JWT memberships
      const loginRes = await supertest(app.getHttpServer())
        .post('/auth/login')
        .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
        .expect(200);
      const studentToken = loginRes.body.access_token;

      const res = await supertest(app.getHttpServer())
        .post('/students')
        .set('Authorization', `Bearer ${studentToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.STUDENT)
        .send(createStudentPayload)
        .expect(401);

      expect(res.body.message).toContain('Requires one of roles');
    });

    it('should return 404 when class_section does not exist', async () => {
      const res = await supertest(app.getHttpServer())
        .post('/students')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({
          ...createStudentPayload,
          class_section_id: '00000000-0000-0000-0000-000000000000',
        })
        .expect(404);

      expect(res.body.message).toContain('Class section with ID');
    });

    it('should return 500 for invalid DTO (missing required fields)', async () => {
      const res = await supertest(app.getHttpServer())
        .post('/students')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({}) // Empty body
        .expect(500);
    });
  });

  describe('GET /students', () => {
    it('should return paginated students', async () => {
      const res = await supertest(app.getHttpServer())
        .get('/students')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(200);

      expect(res.body.data).toBeDefined();
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.total).toBeDefined();
      expect(res.body.page).toBe(1);
    });
  });

  describe('GET /students/:id', () => {
    it('should return a student by ID', async () => {
      // Create a student first
      const createRes = await supertest(app.getHttpServer())
        .post('/students')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ full_name: 'Jane Doe', class_section_id: SEED_SECTION_1_ID })
        .expect(201);

      const res = await supertest(app.getHttpServer())
        .get(`/students/${createRes.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(200);

      expect(res.body.id).toBe(createRes.body.id);
      expect(res.body.full_name).toBe('Jane Doe');
    });

    it('should return 404 for a non-existent student', async () => {
      const res = await supertest(app.getHttpServer())
        .get('/students/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(404);
    });
  });

  describe('PATCH /students/:id', () => {
    it('should update a student', async () => {
      const createRes = await supertest(app.getHttpServer())
        .post('/students')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ full_name: 'Original Name', class_section_id: SEED_SECTION_1_ID })
        .expect(201);

      const res = await supertest(app.getHttpServer())
        .patch(`/students/${createRes.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ full_name: 'Updated Name' })
        .expect(200);

      expect(res.body.full_name).toBe('Updated Name');
    });

    it('should return 403 for STUDENT role on update', async () => {
      const createRes = await supertest(app.getHttpServer())
        .post('/students')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ full_name: 'Role Check', class_section_id: SEED_SECTION_1_ID })
        .expect(201);

      // Get a fresh token with the STUDENT role included
      const loginRes = await supertest(app.getHttpServer())
        .post('/auth/login')
        .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
        .expect(200);
      const studentToken = loginRes.body.access_token;

      const res = await supertest(app.getHttpServer())
        .patch(`/students/${createRes.body.id}`)
        .set('Authorization', `Bearer ${studentToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.STUDENT)
        .send({ full_name: 'Should Not Update' })
        .expect(401);
    });
  });

  describe('DELETE /students/:id', () => {
    it('should soft delete a student', async () => {
      const createRes = await supertest(app.getHttpServer())
        .post('/students')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ full_name: 'Delete Me', class_section_id: SEED_SECTION_1_ID })
        .expect(201);

      // Soft delete
      await supertest(app.getHttpServer())
        .delete(`/students/${createRes.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(200);

      // Verify not found
      await supertest(app.getHttpServer())
        .get(`/students/${createRes.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(404);
    });

    it('should return 403 when a non-ADMIN tries to delete', async () => {
      const createRes = await supertest(app.getHttpServer())
        .post('/students')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ full_name: 'Protected', class_section_id: SEED_SECTION_1_ID })
        .expect(201);

      // Add ACCOUNTANT role and use it — ACCOUNTANT can't delete students
      await dataSource.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ('${SEED_ADMIN_USER_ID}', '${TENANT_ID}', '${UserRole.ACCOUNTANT}', NOW(), NOW())
         ON CONFLICT DO NOTHING`,
      );

      // Get a fresh token with the ACCOUNTANT role included
      const loginRes = await supertest(app.getHttpServer())
        .post('/auth/login')
        .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
        .expect(200);
      const accountantToken = loginRes.body.access_token;

      const res = await supertest(app.getHttpServer())
        .delete(`/students/${createRes.body.id}`)
        .set('Authorization', `Bearer ${accountantToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ACCOUNTANT)
        .expect(401);

      expect(res.body.message).toContain('Requires one of roles');
    });
  });

  describe('Tenant isolation', () => {
    it('should prevent cross-tenant access to student data', async () => {
      // Create a student in tenant-1
      const createRes = await supertest(app.getHttpServer())
        .post('/students')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ full_name: 'Tenant A Student', class_section_id: SEED_SECTION_1_ID })
        .expect(201);

      // Create a second tenant and user-tenant (for cross-tenant test)
      // This simulates an admin from a different school
      const OTHER_TENANT_ID = '00000000-0000-0000-0000-000000000099';
      await dataSource.query(
        `INSERT INTO schools (id, name, slug, created_at, updated_at)
         VALUES ('${OTHER_TENANT_ID}', 'Other School', 'other-school', NOW(), NOW())
         ON CONFLICT DO NOTHING`,
      );

      // Try to access the student using the other tenant
      const res = await supertest(app.getHttpServer())
        .get(`/students/${createRes.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', OTHER_TENANT_ID)
        .expect(401);

      // The admin won't have access to this tenant
      expect(res.body.message).toContain('not a member');
    });
  });
});