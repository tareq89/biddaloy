import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from '../../app.module';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { DataSource } from 'typeorm';
import { UserRole, FeeType, FeeApplicability } from '@beton-boi/shared';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_USER_ID,
  SEED_ADMIN_PASSWORD,
  SEED_CLASS_1_ID,
  SEED_SECTION_1_ID,
  SEED_ACADEMIC_YEAR_ID,
} from '@test/constants';

/**
 * E2E tests for the fee generation endpoint.
 *
 * Tests RBAC (ADMIN/ACCOUNTANT allowed, others denied), tenant isolation,
 * and the end-to-end shape of a generation run.
 */

const OTHER_TENANT_ID = '00000000-0000-4000-8000-000000000099';

describe('Fee Generation E2E', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let token: string;

  const TENANT_ID = SEED_TENANT_ID;

  async function createStudent(registrationNumber: string) {
    const res = await dataSource.query(
      `INSERT INTO students (id, full_name, registration_number, roll_number, class_section_id, tenant_id, date_of_birth, preferred_communication, enrollment_status, created_at, updated_at)
       VALUES (DEFAULT, $1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
       RETURNING id`,
      ['Gen Student', registrationNumber, 1, SEED_SECTION_1_ID, TENANT_ID, '2010-01-01', 'SMS', 'ACTIVE'],
    );
    return res[0].id;
  }

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL must be set to run e2e tests');
    }
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-production';
    process.env.NODE_ENV = 'test';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();

    dataSource = app.get(DataSource);

    // Grant the seed admin ACCOUNTANT and STUDENT memberships on TENANT_ID too,
    // so a single login/token carries multiple roles (selected per-request via
    // X-Role) for the RBAC matrix below — same pattern used in
    // fee-structures.e2e-spec.ts.
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [SEED_ADMIN_USER_ID, TENANT_ID, UserRole.ACCOUNTANT],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [SEED_ADMIN_USER_ID, TENANT_ID, UserRole.STUDENT],
    );

    const loginRes = await supertest(app.getHttpServer())
      .post('/auth/login')
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    token = loginRes.body.access_token;
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  describe('POST /fees/generate', () => {
    it('should generate StudentFee records for ADMIN role', async () => {
      const studentId = await createStudent('REG-GEN-E2E-0001');
      await supertest(app.getHttpServer())
        .post('/fee-structures')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .send({
          fee_type: FeeType.MONTHLY_TUITION,
          name: 'E2E Tuition',
          amount: 1000,
          applicability: FeeApplicability.ALL,
          class_id: SEED_CLASS_1_ID,
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
          month: 1,
        })
        .expect(201);

      const res = await supertest(app.getHttpServer())
        .post('/fees/generate')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .send({ academic_year_id: SEED_ACADEMIC_YEAR_ID, month: 1, year: 2026 })
        .expect(201);

      expect(res.body.generated).toBeGreaterThanOrEqual(1);
      expect(res.body.students_evaluated).toBeGreaterThanOrEqual(1);

      const fee = await dataSource.query(
        `SELECT * FROM student_fees WHERE student_id = $1 AND month = 1 AND year = 2026`,
        [studentId],
      );
      expect(fee).toHaveLength(1);
      expect(Number(fee[0].total_amount)).toBe(1000);
    });

    it('should allow ACCOUNTANT role', async () => {
      await supertest(app.getHttpServer())
        .post('/fees/generate')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ACCOUNTANT)
        .send({ academic_year_id: SEED_ACADEMIC_YEAR_ID, month: 2, year: 2026 })
        .expect(201);
    });

    it('should return 401 for STUDENT role', async () => {
      const res = await supertest(app.getHttpServer())
        .post('/fees/generate')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.STUDENT)
        .send({ academic_year_id: SEED_ACADEMIC_YEAR_ID, month: 1, year: 2026 })
        .expect(401);

      expect(res.body.message).toContain('Requires one of roles');
    });

    it('should be idempotent when called twice for the same month', async () => {
      await supertest(app.getHttpServer())
        .post('/fee-structures')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .send({
          fee_type: FeeType.MONTHLY_TUITION,
          name: 'Idempotency Fee',
          amount: 750,
          class_id: SEED_CLASS_1_ID,
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
          month: 3,
        })
        .expect(201);

      const first = await supertest(app.getHttpServer())
        .post('/fees/generate')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .send({ academic_year_id: SEED_ACADEMIC_YEAR_ID, month: 3, year: 2026 })
        .expect(201);

      const second = await supertest(app.getHttpServer())
        .post('/fees/generate')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .send({ academic_year_id: SEED_ACADEMIC_YEAR_ID, month: 3, year: 2026 })
        .expect(201);

      expect(second.body.generated).toBe(0);
      expect(second.body.skipped).toBe(first.body.generated);
    });

    it('should return 400 for invalid DTO (missing required fields)', async () => {
      await supertest(app.getHttpServer())
        .post('/fees/generate')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .send({})
        .expect(400);
    });

    it('should return 400 when the year falls outside the academic year range', async () => {
      // Seeded academic year covers 2026-01-01 through 2026-12-31 only.
      await supertest(app.getHttpServer())
        .post('/fees/generate')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .send({ academic_year_id: SEED_ACADEMIC_YEAR_ID, month: 1, year: 2027 })
        .expect(400);
    });

    it('should return 404 when academic year belongs to another tenant', async () => {
      await dataSource.query(
        `INSERT INTO schools (id, name, slug, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW())
         ON CONFLICT DO NOTHING`,
        [OTHER_TENANT_ID, 'Other School', 'other-school-fee-generation'],
      );
      const otherAcademicYearId = '00000000-0000-4000-8000-000000000923';
      await dataSource.query(
        `INSERT INTO academic_years (id, name, start_date, end_date, is_current, tenant_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT DO NOTHING`,
        [otherAcademicYearId, 'Other AY', '2026-01-01', '2026-12-31', false, OTHER_TENANT_ID],
      );

      await supertest(app.getHttpServer())
        .post('/fees/generate')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .send({ academic_year_id: otherAcademicYearId, month: 1, year: 2026 })
        .expect(404);
    });
  });
});
