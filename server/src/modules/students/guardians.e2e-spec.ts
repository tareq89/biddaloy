import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { DataSource } from 'typeorm';
import { PaymentMethod, UserRole } from '@biddaloy/shared';
import { randomUUID } from 'crypto';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_USER_ID,
  SEED_ADMIN_PASSWORD,
  SEED_SECTION_1_ID,
  SEED_SECTION_2_ID,
} from '@test/constants';
import { ensureFeeStructure, periodStart } from '@test/helpers/fee-fixture.helper';

import { Teacher } from '../academics/entities/teacher.entity';
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
  let accountantToken: string;

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

    // [39.2.4] An ACCOUNTANT reads guardians (GUARDIAN_READ) but has no STUDENT_RECORDS_READ.
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [SEED_ADMIN_USER_ID, TENANT_ID, UserRole.ACCOUNTANT],
    );
    // Re-login so the token carries the new membership (same as the STUDENT one above).
    const accountantLoginRes = await supertest(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    accountantToken = accountantLoginRes.body.access_token;
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

    it('should return 403 for STUDENT role', async () => {
      const res = await supertest(app.getHttpServer())
        .post('/api/v1/guardians')
        .set('Authorization', `Bearer ${studentToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.STUDENT)
        .send({ full_name: 'Role Check', relationship: 'Guardian' })
        .expect(403);

      expect(res.body.message).toContain('Requires permission(s)');
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

    it('should return 403 for STUDENT role', async () => {
      const res = await supertest(app.getHttpServer())
        .get('/api/v1/guardians')
        .set('Authorization', `Bearer ${studentToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.STUDENT)
        .expect(403);

      expect(res.body.message).toContain('Requires permission(s)');
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

    // [8.10.7.4.13] `?incomplete=` is the list behind the "guardians incomplete" card.
    describe('?incomplete filter', () => {
      const TOKEN = 'IncFilterZq';
      const list = (qs: string) =>
        supertest(app.getHttpServer())
          .get(`/api/v1/guardians?search=${TOKEN}${qs}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .set('X-Tenant-ID', TENANT_ID)
          .expect(200);

      // Rows are wiped between tests, so seed per test.
      beforeEach(async () => {
        const rows: Array<[string, string, string | null, string | null, Date | null]> = [
          [`${TOKEN} Complete`, 'Father', '01711000001', null, null],
          [`${TOKEN} NoPhones`, 'Mother', null, null, null],
          [`${TOKEN} BlankRelation`, ' ', '01711000002', null, null],
          [`${TOKEN} DeletedIncomplete`, ' ', null, null, new Date()],
        ];
        for (const [name, rel, phone, alt, deleted] of rows) {
          await dataSource.query(
            `INSERT INTO guardians (full_name, relationship, phone, alternate_phone, tenant_id, deleted_at)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [name, rel, phone, alt, TENANT_ID, deleted],
          );
        }
      });

      it('?incomplete=true returns only incomplete rows (soft-deleted excluded), total matches', async () => {
        const res = await list('&incomplete=true');
        const names = res.body.data.map((g: any) => g.full_name).sort();
        expect(names).toEqual([`${TOKEN} BlankRelation`, `${TOKEN} NoPhones`]);
        expect(res.body.total).toBe(2);
      });

      it('?incomplete=false and no param return every live guardian', async () => {
        for (const qs of ['&incomplete=false', '']) {
          const res = await list(qs);
          expect(res.body.total).toBe(3);
        }
      });

      it('rejects a non-boolean value', async () => {
        await supertest(app.getHttpServer())
          .get('/api/v1/guardians?incomplete=maybe')
          .set('Authorization', `Bearer ${adminToken}`)
          .set('X-Tenant-ID', TENANT_ID)
          .expect(400);
      });
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

    it('should return 403 for STUDENT role', async () => {
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
        .expect(403);

      expect(res.body.message).toContain('Requires permission(s)');
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

      const structureId = await ensureFeeStructure(dataSource);
      const academicYear = await dataSource.query(
        `SELECT id FROM academic_years WHERE tenant_id = $1 LIMIT 1`,
        [TENANT_ID],
      );
      const feeRes = await dataSource.query(
        `INSERT INTO student_fees (id, student_id, academic_year_id, fee_structure_id, period_start, due_date, total_amount, paid_amount, discount_amount, status, created_at, updated_at)
         VALUES (DEFAULT, $1, $2, $3, $4::date, $5::date, $6, 0, 0, 'PENDING', NOW(), NOW())
         RETURNING id`,
        [
          studentRes.body.id,
          academicYear[0].id,
          structureId,
          periodStart(1, 2026),
          '2026-01-10',
          1500,
        ],
      );

      await supertest(app.getHttpServer())
        .post('/api/v1/payments/checkout')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({
          idempotency_key: randomUUID(),
          lines: [{ student_fee_id: feeRes[0].id, amount: 1500, one_off_discount: 0 }],
          payment_method: PaymentMethod.CASH,
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

    it('should return 403 for STUDENT role', async () => {
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
        .expect(403);

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

    describe('[68.4.05] phone/email of a guardian linked to a login', () => {
      const patch = (id: string, body: object) =>
        supertest(app.getHttpServer())
          .patch(`/api/v1/guardians/${id}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .set('X-Tenant-ID', TENANT_ID)
          .send(body);
      const create = async (name: string) =>
        (
          await supertest(app.getHttpServer())
            .post('/api/v1/guardians')
            .set('Authorization', `Bearer ${adminToken}`)
            .set('X-Tenant-ID', TENANT_ID)
            .send({ full_name: name, relationship: 'Father', phone: '+8801711111111' })
            .expect(201)
        ).body.id as string;

      it('staff cannot change a linked guardian phone: 409 CONTACT_OWNED_BY_LOGIN', async () => {
        const id = await create('Linked Guardian');
        await dataSource.query(`UPDATE guardians SET user_id = $1 WHERE id = $2`, [
          SEED_ADMIN_USER_ID,
          id,
        ]);
        try {
          const res = await patch(id, { phone: '+8801722222222' }).expect(409);
          expect(res.body.details).toMatchObject({ code: 'CONTACT_OWNED_BY_LOGIN' });
          // Other fields and an unchanged phone still save.
          await patch(id, { occupation: 'Farmer', phone: '+8801711111111' }).expect(200);
        } finally {
          await dataSource.query(`UPDATE guardians SET user_id = NULL WHERE id = $1`, [id]);
        }
      });

      it('an unlinked guardian keeps today behaviour: 200', async () => {
        const id = await create('Unlinked Guardian');
        await patch(id, { phone: '+8801733333333' }).expect(200);
      });
    });

    it('should return 403 for STUDENT role on update', async () => {
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
        .expect(403);

      expect(res.body.message).toContain('Requires permission(s)');
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

    it('should return 403 for STUDENT role on delete', async () => {
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
        .expect(403);

      expect(res.body.message).toContain('Requires permission(s)');
    });
  });

  // [39.2.4] D14 — a guardian response embeds its children; health_notes must not ride along
  // for a caller without STUDENT_RECORDS_READ.
  describe('health_notes on guardian responses', () => {
    it('is hidden from an ACCOUNTANT on every route that embeds children, and visible to ADMIN', async () => {
      const studentRes = await supertest(app.getHttpServer())
        .post('/api/v1/students')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({
          full_name: 'Health Notes Student',
          class_section_id: SEED_SECTION_1_ID,
          health_notes: 'severe peanut allergy',
        })
        .expect(201);
      expect(studentRes.body.health_notes).toBe('severe peanut allergy');

      const asAdmin = (req: supertest.Test) =>
        req.set('Authorization', `Bearer ${adminToken}`).set('X-Tenant-ID', TENANT_ID);
      const asAccountant = (req: supertest.Test) =>
        req
          .set('Authorization', `Bearer ${accountantToken}`)
          .set('X-Tenant-ID', TENANT_ID)
          .set('X-Role', UserRole.ACCOUNTANT);

      const created = await asAccountant(supertest(app.getHttpServer()).post('/api/v1/guardians'))
        .send({
          full_name: 'Accountant Made Guardian',
          relationship: 'Mother',
          student_ids: [studentRes.body.id],
        })
        .expect(201);
      const id = created.body.id;
      expect(created.body.students).toHaveLength(1);

      const list = await asAccountant(
        supertest(app.getHttpServer()).get('/api/v1/guardians'),
      ).expect(200);
      const one = await asAccountant(
        supertest(app.getHttpServer()).get(`/api/v1/guardians/${id}`),
      ).expect(200);
      const updated = await asAccountant(
        supertest(app.getHttpServer()).patch(`/api/v1/guardians/${id}`),
      )
        .send({ occupation: 'Teacher' })
        .expect(200);

      for (const body of [created.body, list.body, one.body, updated.body]) {
        expect(JSON.stringify(body)).not.toContain('peanut');
        expect(JSON.stringify(body)).not.toContain('health_notes');
      }

      const adminView = await asAdmin(
        supertest(app.getHttpServer()).get(`/api/v1/guardians/${id}`),
      ).expect(200);
      expect(adminView.body.students[0].health_notes).toBe('severe peanut allergy');
    });
  });

  describe('[68.3.01] TEACHER section scope', () => {
    // The seed admin user doubles as the teacher (TEACHER membership + a `teachers` row), selected
    // with X-Role. `teachers`/`teacher_class_sections`/`subjects` are truncated per test, so the
    // fixture is re-created in beforeEach.
    let scopeToken: string;
    beforeEach(async () => {
      await dataSource.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [SEED_ADMIN_USER_ID, TENANT_ID, UserRole.TEACHER],
      );
      const teacher = await dataSource.getRepository(Teacher).save({
        user_id: SEED_ADMIN_USER_ID,
        employee_id: `EMP-SCOPE-${Math.random().toString(36).slice(2, 8)}`,
        tenant_id: TENANT_ID,
        designations: [],
      });
      const [subject] = await dataSource.query(
        `INSERT INTO subjects (name_en, code, tenant_id, created_at, updated_at)
         VALUES ('Scope Maths', $1, $2, NOW(), NOW()) RETURNING id`,
        [`SC-${Math.random().toString(36).slice(2, 8)}`, TENANT_ID],
      );
      // Teaches SEED_SECTION_1 only; SEED_SECTION_2 plays the "other class".
      await dataSource.query(
        `INSERT INTO teacher_class_sections (teacher_id, section_id, tenant_id, subject_id, assignment_type)
         VALUES ($1, $2, $3, $4, 'SUBJECT_TEACHER')`,
        [teacher.id, SEED_SECTION_1_ID, TENANT_ID, subject.id],
      );
      // The JWT embeds the user's memberships, so log in AFTER adding TEACHER.
      const login = await supertest(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
        .expect(200);
      scopeToken = login.body.access_token;
    });

    const asTeacher = (r: supertest.Test) =>
      r
        .set('Authorization', `Bearer ${scopeToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.TEACHER);
    const asAdmin = (r: supertest.Test) =>
      r
        .set('Authorization', `Bearer ${scopeToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ADMIN);
    const get = (path: string) => supertest(app.getHttpServer()).get(`/api/v1${path}`);
    const insertStudent = async (name: string, sectionId: string) => {
      const [row] = await dataSource.query(
        `INSERT INTO students
           (full_name, registration_number, roll_number, class_section_id, tenant_id,
            enrollment_status, preferred_communication, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'ACTIVE', 'SMS', NOW(), NOW()) RETURNING id`,
        [
          name,
          `SC-${Math.random().toString(36).slice(2, 12)}`,
          Math.floor(Math.random() * 1000000),
          sectionId,
          TENANT_ID,
        ],
      );
      return row.id as string;
    };

    const insertGuardian = async (name: string, studentIds: string[]) => {
      const [row] = await dataSource.query(
        `INSERT INTO guardians (full_name, relationship, tenant_id, created_at, updated_at)
         VALUES ($1, 'PARENT', $2, NOW(), NOW()) RETURNING id`,
        [name, TENANT_ID],
      );
      for (const studentId of studentIds) {
        await dataSource.query(
          `INSERT INTO student_guardians (student_id, guardian_id) VALUES ($1, $2)`,
          [studentId, row.id],
        );
      }
      return row.id as string;
    };

    it('TEACHER GET /guardians lists only guardians of own-section students', async () => {
      const mineStudent = await insertStudent('Scope Mine', SEED_SECTION_1_ID);
      const otherStudent = await insertStudent('Scope Other', SEED_SECTION_2_ID);
      const mine = await insertGuardian('Scope Guardian Mine', [mineStudent]);
      const both = await insertGuardian('Scope Guardian Both', [mineStudent, otherStudent]);
      const other = await insertGuardian('Scope Guardian Other', [otherStudent]);
      const res = await asTeacher(get('/guardians?limit=100')).expect(200);
      const ids = res.body.data.map((g: { id: string }) => g.id);
      expect(ids).toEqual(expect.arrayContaining([mine, both]));
      expect(ids).not.toContain(other);
      expect(new Set(ids).size).toBe(ids.length);
    });

    // [8.10.7.4.13] The incomplete filter narrows; it must never widen the teacher's scope.
    it('TEACHER GET /guardians?incomplete=true stays inside own sections', async () => {
      const mineStudent = await insertStudent('Scope Mine', SEED_SECTION_1_ID);
      const otherStudent = await insertStudent('Scope Other', SEED_SECTION_2_ID);
      // insertGuardian leaves both phones NULL, so both are incomplete.
      const mine = await insertGuardian('Scope Inc Mine', [mineStudent]);
      const other = await insertGuardian('Scope Inc Other', [otherStudent]);
      const res = await asTeacher(get('/guardians?limit=100&incomplete=true')).expect(200);
      const ids = res.body.data.map((g: { id: string }) => g.id);
      expect(ids).toContain(mine);
      expect(ids).not.toContain(other);
    });

    it('TEACHER GET /guardians/:id of an other-section-only guardian -> 404', async () => {
      const mineStudent = await insertStudent('Scope Mine', SEED_SECTION_1_ID);
      const otherStudent = await insertStudent('Scope Other', SEED_SECTION_2_ID);
      const mine = await insertGuardian('Scope Guardian Mine', [mineStudent]);
      const other = await insertGuardian('Scope Guardian Other', [otherStudent]);
      await asTeacher(get(`/guardians/${other}`)).expect(404);
      await asTeacher(get(`/guardians/${mine}`)).expect(200);
    });

    it('TEACHER GET /guardians/:id hides the guardian’s children in other sections', async () => {
      const mineStudent = await insertStudent('Scope Mine', SEED_SECTION_1_ID);
      const otherStudent = await insertStudent('Scope Other', SEED_SECTION_2_ID);
      const both = await insertGuardian('Scope Guardian Both', [mineStudent, otherStudent]);
      const res = await asTeacher(get(`/guardians/${both}`)).expect(200);
      expect(res.body.students.map((s: { id: string }) => s.id)).toEqual([mineStudent]);
      const admin = await asAdmin(get(`/guardians/${both}`)).expect(200);
      expect(admin.body.students).toHaveLength(2);
    });

    it('ADMIN still sees guardians of every section', async () => {
      const otherStudent = await insertStudent('Scope Other', SEED_SECTION_2_ID);
      const other = await insertGuardian('Scope Guardian Other', [otherStudent]);
      await asAdmin(get(`/guardians/${other}`)).expect(200);
    });
  });
});
