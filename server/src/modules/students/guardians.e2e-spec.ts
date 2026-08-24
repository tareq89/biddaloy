import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
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
  SEED_SECTION_1_ID,
} from '@test/constants';

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
    process.env.DATABASE_URL =
      process.env.DATABASE_URL || 'postgres://postgres:***@localhost:5432/biddaloy';
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-production';
    process.env.NODE_ENV = 'test';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();

    dataSource = app.get(DataSource);

    const loginRes = await supertest(app.getHttpServer())
      .post('/api/v1/auth/login')
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
      .post('/api/v1/auth/login')
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
        .post('/api/v1/guardians')
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
        .post('/api/v1/guardians')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ full_name: 'No Tenant', relationship: 'Mother' })
        .expect(401);

      expect(res.body.message).toBe('X-Tenant-ID header is required');
    });

    it('should return 401 for STUDENT role', async () => {
      const res = await supertest(app.getHttpServer())
        .post('/api/v1/guardians')
        .set('Authorization', `Bearer ${studentToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.STUDENT)
        .send({ full_name: 'Role Check', relationship: 'Guardian' })
        .expect(401);

      expect(res.body.message).toContain('Requires one of roles');
    });

    it('should return 400 for invalid DTO (missing required fields)', async () => {
      const res = await supertest(app.getHttpServer())
        .post('/api/v1/guardians')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({})
        .expect(400);
    });
  });

  describe('GET /guardians', () => {
    it('should list guardians (searchable by name)', async () => {
      const res = await supertest(app.getHttpServer())
        .get('/api/v1/guardians')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(200);

      expect(res.body.data).toBeDefined();
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.total).toBeDefined();
    });

    it('should return 401 for STUDENT role', async () => {
      const res = await supertest(app.getHttpServer())
        .get('/api/v1/guardians')
        .set('Authorization', `Bearer ${studentToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.STUDENT)
        .expect(401);

      expect(res.body.message).toContain('Requires one of roles');
    });

    // [8.11.4]'s list page "Linked students" column, and the global-search
    // launcher's `guardian.students.length > 0` filter — GuardianService's
    // findAll didn't load the `students` relation before this issue.
    it('should include each guardian`s linked students', async () => {
      const studentRes = await supertest(app.getHttpServer())
        .post('/api/v1/students')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ full_name: 'List Column Student', class_section_id: SEED_SECTION_1_ID })
        .expect(201);

      const createRes = await supertest(app.getHttpServer())
        .post('/api/v1/guardians')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({
          full_name: 'Guardian With Linked Student',
          relationship: 'Father',
          student_ids: [studentRes.body.id],
        })
        .expect(201);

      const listRes = await supertest(app.getHttpServer())
        .get('/api/v1/guardians')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(200);

      const guardian = listRes.body.data.find((g: any) => g.id === createRes.body.id);
      expect(guardian.students).toBeDefined();
      expect(guardian.students).toHaveLength(1);
      expect(guardian.students[0].id).toBe(studentRes.body.id);
    });
  });

  describe('GET /guardians/:id', () => {
    it('should return a single guardian with linked students', async () => {
      const studentRes = await supertest(app.getHttpServer())
        .post('/api/v1/students')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ full_name: 'Detail Page Student', class_section_id: SEED_SECTION_1_ID })
        .expect(201);

      const createRes = await supertest(app.getHttpServer())
        .post('/api/v1/guardians')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({
          full_name: 'Detail Page Guardian',
          relationship: 'Father',
          student_ids: [studentRes.body.id],
        })
        .expect(201);

      const res = await supertest(app.getHttpServer())
        .get(`/api/v1/guardians/${createRes.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(200);

      expect(res.body.id).toBe(createRes.body.id);
      expect(res.body.full_name).toBe('Detail Page Guardian');
      expect(res.body.students).toHaveLength(1);
      expect(res.body.students[0].id).toBe(studentRes.body.id);
    });

    it('should return 404 for a guardian that does not exist', async () => {
      await supertest(app.getHttpServer())
        .get('/api/v1/guardians/00000000-0000-4000-8000-000000000000')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(404);
    });

    it('should return 400 for a malformed (non-UUID) guardian id', async () => {
      await supertest(app.getHttpServer())
        .get('/api/v1/guardians/not-a-uuid')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(400);
    });

    it('should return 401 for STUDENT role', async () => {
      const createRes = await supertest(app.getHttpServer())
        .post('/api/v1/guardians')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ full_name: 'Role Checked Guardian', relationship: 'Mother' })
        .expect(201);

      const res = await supertest(app.getHttpServer())
        .get(`/api/v1/guardians/${createRes.body.id}`)
        .set('Authorization', `Bearer ${studentToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.STUDENT)
        .expect(401);

      expect(res.body.message).toContain('Requires one of roles');
    });
  });

  describe('GET /payments/guardian/:guardianId', () => {
    it("should return payments for every one of the guardian's linked students", async () => {
      const studentRes = await supertest(app.getHttpServer())
        .post('/api/v1/students')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ full_name: 'Payment History Student', class_section_id: SEED_SECTION_1_ID })
        .expect(201);

      const guardianRes = await supertest(app.getHttpServer())
        .post('/api/v1/guardians')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({
          full_name: 'Payment History Guardian',
          relationship: 'Father',
          student_ids: [studentRes.body.id],
        })
        .expect(201);

      await supertest(app.getHttpServer())
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({
          student_id: studentRes.body.id,
          total_amount: 1500,
          payment_method: 'CASH',
        })
        .expect(201);

      const res = await supertest(app.getHttpServer())
        .get(`/api/v1/payments/guardian/${guardianRes.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(1);
      expect(Number(res.body[0].total_amount)).toBe(1500);
    });

    it('should return 401 for STUDENT role', async () => {
      const guardianRes = await supertest(app.getHttpServer())
        .post('/api/v1/guardians')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ full_name: 'Role Checked Payment Guardian', relationship: 'Mother' })
        .expect(201);

      const res = await supertest(app.getHttpServer())
        .get(`/api/v1/payments/guardian/${guardianRes.body.id}`)
        .set('Authorization', `Bearer ${studentToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.STUDENT)
        .expect(401);

      expect(res.body.message).toContain('Requires one of roles');
    });

    it('should return 401 when X-Tenant-ID names a tenant the user is not a member of', async () => {
      const guardianRes = await supertest(app.getHttpServer())
        .post('/api/v1/guardians')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ full_name: 'Foreign Tenant Header Guardian', relationship: 'Mother' })
        .expect(201);

      const FOREIGN_TENANT_ID = '00000000-0000-4000-8000-000000000099';

      const res = await supertest(app.getHttpServer())
        .get(`/api/v1/payments/guardian/${guardianRes.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', FOREIGN_TENANT_ID)
        .expect(401);

      expect(res.body.message).toContain('is not a member of tenant');
    });

    it('should return 400 for a malformed (non-UUID) guardian id', async () => {
      await supertest(app.getHttpServer())
        .get('/api/v1/payments/guardian/not-a-uuid')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(400);
    });

    it('should return 404 for a guardian in a different tenant', async () => {
      // Inserted directly (not via the API) — the seed admin isn't a member
      // of this other tenant, so a POST through the API would 401 at the
      // ContextGuard before ever reaching PaymentService. This test is
      // about `findByGuardian`'s own tenant scoping, not membership.
      const OTHER_TENANT_ID = '00000000-0000-4000-8000-000000000098';
      await dataSource.query(
        `INSERT INTO schools (id, name, slug, created_at, updated_at)
         VALUES ($1, 'Payments Other School', 'payments-other-school', NOW(), NOW())
         ON CONFLICT DO NOTHING`,
        [OTHER_TENANT_ID],
      );
      const otherGuardian = await dataSource.query(
        `INSERT INTO guardians (id, full_name, relationship, preferred_communication, tenant_id, created_at, updated_at)
         VALUES (DEFAULT, 'Other Tenant Guardian', 'Father', 'SMS', $1, NOW(), NOW())
         RETURNING id`,
        [OTHER_TENANT_ID],
      );

      await supertest(app.getHttpServer())
        .get(`/api/v1/payments/guardian/${otherGuardian[0].id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(404);
    });
  });

  describe('GET /communications/guardian/:guardianId', () => {
    it('should return every message logged directly against the guardian', async () => {
      const guardianRes = await supertest(app.getHttpServer())
        .post('/api/v1/guardians')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({
          full_name: 'Comms History Guardian',
          relationship: 'Mother',
          phone: '+8801700000001',
        })
        .expect(201);

      // Insert the log row directly — sending a real message would enqueue
      // a BullMQ job against a real SMS/WhatsApp provider, which is out of
      // scope for this read endpoint's test.
      await dataSource.query(
        `INSERT INTO communication_logs
           (tenant_id, medium, recipient_address, recipient_name, message_body, status, trigger, guardian_id, created_at, updated_at)
         VALUES ($1, 'SMS', '+8801700000001', 'Comms History Guardian', 'Fee reminder', 'SENT', 'MANUAL', $2, NOW(), NOW())`,
        [TENANT_ID, guardianRes.body.id],
      );

      const res = await supertest(app.getHttpServer())
        .get(`/api/v1/communications/guardian/${guardianRes.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].recipient_name).toBe('Comms History Guardian');
    });

    it('should return 404 for a guardian in a different tenant', async () => {
      // Inserted directly — same reasoning as the payments cross-tenant
      // test above.
      const OTHER_TENANT_ID = '00000000-0000-4000-8000-000000000097';
      await dataSource.query(
        `INSERT INTO schools (id, name, slug, created_at, updated_at)
         VALUES ($1, 'Comms Other School', 'comms-other-school', NOW(), NOW())
         ON CONFLICT DO NOTHING`,
        [OTHER_TENANT_ID],
      );
      const otherGuardian = await dataSource.query(
        `INSERT INTO guardians (id, full_name, relationship, preferred_communication, tenant_id, created_at, updated_at)
         VALUES (DEFAULT, 'Other Tenant Comms Guardian', 'Father', 'SMS', $1, NOW(), NOW())
         RETURNING id`,
        [OTHER_TENANT_ID],
      );

      await supertest(app.getHttpServer())
        .get(`/api/v1/communications/guardian/${otherGuardian[0].id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(404);
    });
  });

  describe('PATCH /guardians/:id', () => {
    it('should update a guardian', async () => {
      const createRes = await supertest(app.getHttpServer())
        .post('/api/v1/guardians')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ full_name: 'Original Guardian', relationship: 'Father' })
        .expect(201);

      const res = await supertest(app.getHttpServer())
        .patch(`/api/v1/guardians/${createRes.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ full_name: 'Updated Guardian', phone: '+8801711111111' })
        .expect(200);

      expect(res.body.full_name).toBe('Updated Guardian');
      expect(res.body.phone).toBe('+8801711111111');
    });

    it('clears an optional field to NULL when sent as an empty string, not left unchanged', async () => {
      // [8.11.4]'s edit-guardian dialog sends `''`, not an omitted key, to
      // explicitly clear a field — regression coverage for the bug where
      // that used to be indistinguishable from "field not provided".
      const createRes = await supertest(app.getHttpServer())
        .post('/api/v1/guardians')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({
          full_name: 'Clearable Fields',
          relationship: 'Father',
          phone: '+8801711111111',
          email: 'before@example.com',
          occupation: 'Farmer',
        })
        .expect(201);

      const res = await supertest(app.getHttpServer())
        .patch(`/api/v1/guardians/${createRes.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ email: '', occupation: '' })
        .expect(200);

      expect(res.body.email).toBeNull();
      expect(res.body.occupation).toBeNull();
      // Untouched fields are unaffected by the clear.
      expect(res.body.phone).toBe('+8801711111111');
    });

    it('should return 401 for STUDENT role on update', async () => {
      const createRes = await supertest(app.getHttpServer())
        .post('/api/v1/guardians')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ full_name: 'Protected', relationship: 'Mother' })
        .expect(201);

      const res = await supertest(app.getHttpServer())
        .patch(`/api/v1/guardians/${createRes.body.id}`)
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
        .post('/api/v1/guardians')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ full_name: 'Delete Guardian', relationship: 'Father' })
        .expect(201);

      await supertest(app.getHttpServer())
        .delete(`/api/v1/guardians/${createRes.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(200);

      // Verify not found by listing — the guardian should be soft-deleted
      const listRes = await supertest(app.getHttpServer())
        .get('/api/v1/guardians')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(200);

      expect(listRes.body.data.find((g: any) => g.id === createRes.body.id)).toBeUndefined();
    });

    it('should return 401 for STUDENT role on delete', async () => {
      const createRes = await supertest(app.getHttpServer())
        .post('/api/v1/guardians')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ full_name: 'Protected Guardian', relationship: 'Mother' })
        .expect(201);

      const res = await supertest(app.getHttpServer())
        .delete(`/api/v1/guardians/${createRes.body.id}`)
        .set('Authorization', `Bearer ${studentToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.STUDENT)
        .expect(401);

      expect(res.body.message).toContain('Requires one of roles');
    });
  });
});
