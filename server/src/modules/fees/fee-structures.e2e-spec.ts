import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { DataSource } from 'typeorm';
import { UserRole, FeeType } from '@biddaloy/shared';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_USER_ID,
  SEED_ADMIN_PASSWORD,
  SEED_CLASS_1_ID,
  SEED_ACADEMIC_YEAR_ID,
} from '@test/constants';

/**
 * E2E tests for Fee Structure endpoints.
 *
 * A fee structure is now a plain price tag — `name`, `fee_type`, `amount`,
 * `academic_year_id`, and an optional `class_id`/`section_id` label. It no
 * longer decides who gets billed or when: `month`, `is_recurring` and
 * `applicability` are gone from the DTOs and rejected by the whitelist.
 */

const OTHER_TENANT_ID = '00000000-0000-4000-8000-000000000099';
const NON_MEMBER_TENANT_ID = '00000000-0000-4000-8000-000000000098';

describe('Fee Structures E2E', () => {
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

    // Give the seed admin a STUDENT membership on TENANT_ID too, so a single
    // login can carry both roles (selected via X-Role) for the RBAC denial
    // matrix below. Idempotent + parameterized (was previously raw string
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

  describe('POST /fee-structures', () => {
    it('should create a fee structure with ADMIN role', async () => {
      const res = await supertest(app.getHttpServer())
        .post('/api/v1/fee-structures')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({
          fee_type: FeeType.MONTHLY_TUITION,
          name: 'Monthly Tuition',
          amount: 5000,
          class_id: SEED_CLASS_1_ID,
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
        })
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.name).toBe('Monthly Tuition');
      expect(Number(res.body.amount)).toBe(5000);
      expect(res.body.tenant_id).toBe(TENANT_ID);
    });

    it('should create a school-wide fee structure without a class_id', async () => {
      const res = await supertest(app.getHttpServer())
        .post('/api/v1/fee-structures')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({
          fee_type: FeeType.MONTHLY_TUITION,
          name: 'School-wide Fee',
          amount: 500,
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
        })
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.class_id).toBeNull();
    });

    it('should return 400 when the body carries dropped fields (month/applicability)', async () => {
      const res = await supertest(app.getHttpServer())
        .post('/api/v1/fee-structures')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({
          fee_type: FeeType.MONTHLY_TUITION,
          name: 'Whitelist Check',
          amount: 1000,
          class_id: SEED_CLASS_1_ID,
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
          month: 1,
          applicability: 'ALL',
        })
        .expect(400);

      expect(JSON.stringify(res.body.message)).toMatch(/month|applicability/i);
    });

    it('should return 401 without X-Tenant-ID header', async () => {
      const res = await supertest(app.getHttpServer())
        .post('/api/v1/fee-structures')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          fee_type: FeeType.MONTHLY_TUITION,
          name: 'No Tenant Fee',
          amount: 1000,
          class_id: SEED_CLASS_1_ID,
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
        })
        .expect(401);

      expect(res.body.message).toBe('X-Tenant-ID header is required');
    });

    it('should return 401 for STUDENT role', async () => {
      const res = await supertest(app.getHttpServer())
        .post('/api/v1/fee-structures')
        .set('Authorization', `Bearer ${studentToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.STUDENT)
        .send({
          fee_type: FeeType.MONTHLY_TUITION,
          name: 'Role Check',
          amount: 1000,
          class_id: SEED_CLASS_1_ID,
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
        })
        .expect(401);

      expect(res.body.message).toContain('Requires one of roles');
    });

    it('should return 401 for an invalid/non-member X-Tenant-ID', async () => {
      const res = await supertest(app.getHttpServer())
        .post('/api/v1/fee-structures')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', NON_MEMBER_TENANT_ID)
        .send({
          fee_type: FeeType.MONTHLY_TUITION,
          name: 'Wrong Tenant Fee',
          amount: 1000,
          class_id: SEED_CLASS_1_ID,
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
        })
        .expect(401);

      expect(res.body.message).toContain('not a member of tenant');
    });

    it('should return 400 for invalid DTO (missing required fields)', async () => {
      await supertest(app.getHttpServer())
        .post('/api/v1/fee-structures')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({})
        .expect(400);
    });
  });

  describe('GET /fee-structures', () => {
    it('should list fee structures with filters', async () => {
      const res = await supertest(app.getHttpServer())
        .get('/api/v1/fee-structures')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .query({
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
          class_id: SEED_CLASS_1_ID,
        })
        .expect(200);

      expect(res.body.data).toBeDefined();
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.total).toBeDefined();
    });

    /**
     * [5.1] opened the fee catalog to family roles. It is the school's
     * published price list — tenant-scoped but not student-scoped, so a
     * STUDENT sees exactly what staff see and no object-level check applies.
     * Writes (POST/PATCH/DELETE below) stay staff-only.
     */
    it('admits a STUDENT since [5.1]', async () => {
      const res = await supertest(app.getHttpServer())
        .get('/api/v1/fee-structures')
        .set('Authorization', `Bearer ${studentToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.STUDENT)
        .expect(200);

      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  describe('GET /fee-structures/:id', () => {
    it('should return a fee structure by ID', async () => {
      const createRes = await supertest(app.getHttpServer())
        .post('/api/v1/fee-structures')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({
          fee_type: FeeType.MONTHLY_TUITION,
          name: 'Find Fee',
          amount: 3000,
          class_id: SEED_CLASS_1_ID,
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
        })
        .expect(201);

      const res = await supertest(app.getHttpServer())
        .get(`/api/v1/fee-structures/${createRes.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(200);

      expect(res.body.id).toBe(createRes.body.id);
      expect(res.body.name).toBe('Find Fee');
    });

    it('should return 404 for a non-existent fee structure', async () => {
      await supertest(app.getHttpServer())
        .get('/api/v1/fee-structures/00000000-0000-4000-8000-000000000000')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(404);
    });

    /**
     * [5.1] opened the fee catalog to family roles. It is the school's
     * published price list — tenant-scoped but not student-scoped, so a
     * STUDENT sees exactly what staff see and no object-level check applies.
     * Writes (POST/PATCH/DELETE below) stay staff-only.
     */
    it('admits a STUDENT reading one fee structure since [5.1]', async () => {
      const createRes = await supertest(app.getHttpServer())
        .post('/api/v1/fee-structures')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({
          fee_type: FeeType.MONTHLY_TUITION,
          name: 'Role Check Get',
          amount: 1000,
          class_id: SEED_CLASS_1_ID,
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
        })
        .expect(201);

      const res = await supertest(app.getHttpServer())
        .get(`/api/v1/fee-structures/${createRes.body.id}`)
        .set('Authorization', `Bearer ${studentToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.STUDENT)
        .expect(200);

      expect(res.body.id).toBe(createRes.body.id);
    });

    describe('cross-tenant access', () => {
      it('should return 404 when the fee structure belongs to another tenant', async () => {
        await dataSource.query(
          `INSERT INTO schools (id, name, slug, created_at, updated_at)
           VALUES ($1, $2, $3, NOW(), NOW())
           ON CONFLICT DO NOTHING`,
          [OTHER_TENANT_ID, 'Other School', 'other-school-fee-structures'],
        );
        const otherAcademicYearId = '00000000-0000-4000-8000-000000000921';
        const otherClassId = '00000000-0000-4000-8000-000000000922';
        await dataSource.query(
          `INSERT INTO academic_years (id, name, start_date, end_date, is_current, tenant_id, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
           ON CONFLICT DO NOTHING`,
          [otherAcademicYearId, 'Other AY', '2026-01-01', '2026-12-31', false, OTHER_TENANT_ID],
        );
        await dataSource.query(
          `INSERT INTO classes (id, name, academic_year_id, tenant_id, created_at, updated_at)
           VALUES ($1, $2, $3, $4, NOW(), NOW())
           ON CONFLICT DO NOTHING`,
          [otherClassId, 'Other Class', otherAcademicYearId, OTHER_TENANT_ID],
        );

        const otherFeeStructure = await dataSource.query(
          `INSERT INTO fee_structures (id, fee_type, name, amount, class_id, academic_year_id, tenant_id, created_at, updated_at)
           VALUES (DEFAULT, $1, $2, $3, $4, $5, $6, NOW(), NOW())
           RETURNING id`,
          [
            FeeType.MONTHLY_TUITION,
            'Tenant B Fee',
            999,
            otherClassId,
            otherAcademicYearId,
            OTHER_TENANT_ID,
          ],
        );
        const otherFeeStructureId = otherFeeStructure[0].id;

        await supertest(app.getHttpServer())
          .get(`/api/v1/fee-structures/${otherFeeStructureId}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .set('X-Tenant-ID', TENANT_ID)
          .expect(404);

        await supertest(app.getHttpServer())
          .patch(`/api/v1/fee-structures/${otherFeeStructureId}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .set('X-Tenant-ID', TENANT_ID)
          .send({ name: 'Hijacked' })
          .expect(404);

        await supertest(app.getHttpServer())
          .delete(`/api/v1/fee-structures/${otherFeeStructureId}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .set('X-Tenant-ID', TENANT_ID)
          .expect(404);
      });
    });
  });

  describe('PATCH /fee-structures/:id', () => {
    it('should update a fee structure', async () => {
      const createRes = await supertest(app.getHttpServer())
        .post('/api/v1/fee-structures')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({
          fee_type: FeeType.MONTHLY_TUITION,
          name: 'Original Fee',
          amount: 2000,
          class_id: SEED_CLASS_1_ID,
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
        })
        .expect(201);

      const res = await supertest(app.getHttpServer())
        .patch(`/api/v1/fee-structures/${createRes.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ name: 'Updated Fee', amount: 2500 })
        .expect(200);

      expect(res.body.name).toBe('Updated Fee');
      expect(Number(res.body.amount)).toBe(2500);
    });

    it('writes an audit row when amount changes (D7)', async () => {
      const createRes = await supertest(app.getHttpServer())
        .post('/api/v1/fee-structures')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({
          fee_type: FeeType.MONTHLY_TUITION,
          name: 'Audited Fee',
          amount: 1000,
          class_id: SEED_CLASS_1_ID,
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
        })
        .expect(201);

      await supertest(app.getHttpServer())
        .patch(`/api/v1/fee-structures/${createRes.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ amount: 1200 })
        .expect(200);

      const rows = await dataSource.query(
        `SELECT * FROM audit_logs WHERE entity_type = 'FeeStructure' AND entity_id = $1
         ORDER BY created_at ASC`,
        [createRes.body.id],
      );
      expect(rows.length).toBeGreaterThan(0);
      const latest = rows[rows.length - 1];
      expect(latest.action).toBe('UPDATE');
      expect(Number(latest.old_values.amount)).toBe(1000);
      expect(Number(latest.new_values.amount)).toBe(1200);
    });

    it('should return 401 for STUDENT role', async () => {
      const createRes = await supertest(app.getHttpServer())
        .post('/api/v1/fee-structures')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({
          fee_type: FeeType.MONTHLY_TUITION,
          name: 'Role Check Patch',
          amount: 1000,
          class_id: SEED_CLASS_1_ID,
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
        })
        .expect(201);

      const res = await supertest(app.getHttpServer())
        .patch(`/api/v1/fee-structures/${createRes.body.id}`)
        .set('Authorization', `Bearer ${studentToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.STUDENT)
        .send({ name: 'Should Not Apply' })
        .expect(401);

      expect(res.body.message).toContain('Requires one of roles');
    });
  });

  describe('DELETE /fee-structures/:id', () => {
    it('should soft-delete a fee structure: gone from GET, excluded from the default list, present with include_deleted', async () => {
      const createRes = await supertest(app.getHttpServer())
        .post('/api/v1/fee-structures')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({
          fee_type: FeeType.MONTHLY_TUITION,
          name: 'Delete Fee',
          amount: 1500,
          class_id: SEED_CLASS_1_ID,
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
        })
        .expect(201);
      const id = createRes.body.id;

      await supertest(app.getHttpServer())
        .delete(`/api/v1/fee-structures/${id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(200);

      // Verify not found
      await supertest(app.getHttpServer())
        .get(`/api/v1/fee-structures/${id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(404);

      const rows = await dataSource.query(`SELECT deleted_at FROM fee_structures WHERE id = $1`, [
        id,
      ]);
      expect(rows[0].deleted_at).not.toBeNull();

      const defaultList = await supertest(app.getHttpServer())
        .get('/api/v1/fee-structures')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .query({ search: 'Delete Fee' })
        .expect(200);
      expect(defaultList.body.data.find((row: { id: string }) => row.id === id)).toBeUndefined();

      const withDeletedList = await supertest(app.getHttpServer())
        .get('/api/v1/fee-structures')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .query({ search: 'Delete Fee', include_deleted: 'true' })
        .expect(200);
      expect(withDeletedList.body.data.find((row: { id: string }) => row.id === id)).toBeDefined();
    });

    it('should return 401 for STUDENT role on delete', async () => {
      const createRes = await supertest(app.getHttpServer())
        .post('/api/v1/fee-structures')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({
          fee_type: FeeType.MONTHLY_TUITION,
          name: 'Protected Fee',
          amount: 1000,
          class_id: SEED_CLASS_1_ID,
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
        })
        .expect(201);

      const res = await supertest(app.getHttpServer())
        .delete(`/api/v1/fee-structures/${createRes.body.id}`)
        .set('Authorization', `Bearer ${studentToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.STUDENT)
        .expect(401);

      expect(res.body.message).toContain('Requires one of roles');
    });
  });
});
