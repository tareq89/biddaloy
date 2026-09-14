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
  SEED_SECTION_1_ID,
  SEED_ACADEMIC_YEAR_ID,
} from '@test/constants';

/**
 * [16.3.1] E2E tests for the explicit-selection fee generation endpoints —
 * `POST /fees/generate/preview` (read-only) and `POST /fees/generate`
 * (writes). Service-level behavior (duplicate strategies, approval,
 * wallet auto-apply, period normalisation) is covered by
 * `fee-generation.service.integration.spec.ts`; this file only checks the
 * HTTP-layer contract: preview never writes, the happy path works end to
 * end, and RBAC is enforced.
 */
describe('Fee Generation E2E', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let token: string;

  const TENANT_ID = SEED_TENANT_ID;
  let studentSeq = 0;

  async function createStudent(): Promise<string> {
    studentSeq += 1;
    const res = await dataSource.query(
      `INSERT INTO students (id, full_name, registration_number, roll_number, class_section_id, tenant_id, date_of_birth, preferred_communication, enrollment_status, created_at, updated_at)
       VALUES (DEFAULT, $1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
       RETURNING id`,
      [
        'Gen Student',
        `REG-GENV2-E2E-${String(studentSeq).padStart(4, '0')}`,
        studentSeq,
        SEED_SECTION_1_ID,
        TENANT_ID,
        '2010-01-01',
        'SMS',
        'ACTIVE',
      ],
    );
    return res[0].id;
  }

  async function createFeeStructure(): Promise<string> {
    const res = await supertest(app.getHttpServer())
      .post('/api/v1/fee-structures')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', TENANT_ID)
      .set('X-Role', UserRole.ADMIN)
      .send({
        fee_type: FeeType.MONTHLY_TUITION,
        name: `E2E Tuition ${Date.now()}-${Math.random()}`,
        amount: 1000,
        class_id: SEED_CLASS_1_ID,
        academic_year_id: SEED_ACADEMIC_YEAR_ID,
      })
      .expect(201);
    return res.body.id;
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
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();

    dataSource = app.get(DataSource);

    // Seed admin also gets ACCOUNTANT and STUDENT memberships on this
    // tenant, so a single login/token carries multiple roles (selected
    // per-request via X-Role) for the RBAC checks below.
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
      .post('/api/v1/auth/login')
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    token = loginRes.body.access_token;
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  describe('POST /fees/generate/preview', () => {
    it('is read-only: no new bills or batches exist afterward', async () => {
      const studentId = await createStudent();
      const structureId = await createFeeStructure();

      const before = await dataSource.query(
        `SELECT COUNT(*)::int AS count FROM student_fees WHERE student_id = $1`,
        [studentId],
      );
      const batchesBefore = await dataSource.query(
        `SELECT COUNT(*)::int AS count FROM fee_generations`,
      );

      const res = await supertest(app.getHttpServer())
        .post('/api/v1/fees/generate/preview')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .send({
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
          period_start: '2026-04-01',
          period_type: 'MONTH',
          student_ids: [studentId],
          fee_structure_ids: [structureId],
        })
        .expect(201);

      expect(res.body.would_generate).toBe(1);
      expect(res.body.students_total).toBe(1);

      const after = await dataSource.query(
        `SELECT COUNT(*)::int AS count FROM student_fees WHERE student_id = $1`,
        [studentId],
      );
      const batchesAfter = await dataSource.query(
        `SELECT COUNT(*)::int AS count FROM fee_generations`,
      );
      expect(after[0].count).toBe(before[0].count);
      expect(batchesAfter[0].count).toBe(batchesBefore[0].count);
    });
  });

  describe('POST /fees/generate', () => {
    it('happy path: creates a batch and bills for the picked students/structures', async () => {
      const studentId = await createStudent();
      const structureId = await createFeeStructure();

      const res = await supertest(app.getHttpServer())
        .post('/api/v1/fees/generate')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .send({
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
          period_start: '2026-05-01',
          period_type: 'MONTH',
          student_ids: [studentId],
          fee_structure_ids: [structureId],
        })
        .expect(201);

      expect(res.body).toMatchObject({
        generated_count: 1,
        skipped_count: 0,
        removed_count: 0,
        student_count: 1,
      });
      expect(res.body.fee_generation_id).toBeTruthy();

      const bills = await dataSource.query(
        `SELECT * FROM student_fees WHERE student_id = $1 AND fee_generation_id = $2`,
        [studentId, res.body.fee_generation_id],
      );
      expect(bills).toHaveLength(1);
      expect(Number(bills[0].total_amount)).toBe(1000);

      const batch = await dataSource.query(`SELECT * FROM fee_generations WHERE id = $1`, [
        res.body.fee_generation_id,
      ]);
      expect(batch).toHaveLength(1);
      expect(batch[0].generated_count).toBe(1);
    });

    it("denies a role without FEE_GENERATE (STUDENT isn't in the route's @Roles list)", async () => {
      const studentId = await createStudent();
      const structureId = await createFeeStructure();

      const res = await supertest(app.getHttpServer())
        .post('/api/v1/fees/generate')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.STUDENT)
        .send({
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
          period_start: '2026-06-01',
          period_type: 'MONTH',
          student_ids: [studentId],
          fee_structure_ids: [structureId],
        })
        .expect(401);

      expect(res.body.message).toContain('Requires one of roles');
    });
  });
});
