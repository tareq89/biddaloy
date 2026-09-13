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
  SEED_ACADEMIC_YEAR_ID,
} from '@test/constants';

/** [16.1.4] E2E tests for the fee-generation log — GET /fees/generations,
 * GET /fees/generations/:id and GET /fees/generations/:id/bills. */
describe('Fee Generations E2E', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let token: string;

  const TENANT_ID = SEED_TENANT_ID;
  const TENANT_B = '00000000-0000-4000-8000-0000006410b1';
  let studentSeq = 0;
  let batchSeq = 0;

  async function createStudent(tenantId = TENANT_ID): Promise<string> {
    studentSeq += 1;
    const res = await dataSource.query(
      `INSERT INTO students (id, full_name, registration_number, roll_number, class_section_id, tenant_id, date_of_birth, preferred_communication, enrollment_status, created_at, updated_at)
       VALUES (DEFAULT, $1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
       RETURNING id`,
      [
        `Batch Student ${studentSeq}`,
        `REG-FGEN-E2E-${String(studentSeq).padStart(4, '0')}`,
        studentSeq,
        tenantId === TENANT_ID ? SEED_SECTION_1_ID : null,
        tenantId,
        '2010-01-01',
        'SMS',
        'ACTIVE',
      ],
    );
    return res[0].id;
  }

  async function createBatch(
    overrides: {
      tenant_id?: string;
      source?: string;
      generated_by_user_id?: string | null;
    } = {},
  ): Promise<string> {
    batchSeq += 1;
    const res = await dataSource.query(
      `INSERT INTO fee_generations (id, tenant_id, academic_year_id, period_start, period_type, due_date, source, duplicate_strategy, notify_families, structures, student_count, generated_count, skipped_count, removed_count, created_at)
       VALUES (DEFAULT, $1, $2, $3, 'MONTH', $3, $4, 'SKIP', false, $5, 1, 1, 0, 0, NOW())
       RETURNING id`,
      [
        overrides.tenant_id ?? TENANT_ID,
        SEED_ACADEMIC_YEAR_ID,
        `2026-0${(batchSeq % 9) + 1}-01`,
        overrides.source ?? 'MANUAL',
        JSON.stringify([
          { id: 'fs-1', name: 'Tuition', fee_type: 'MONTHLY_TUITION', amount: 1000 },
        ]),
      ],
    );
    const batchId = res[0].id;
    if (overrides.generated_by_user_id !== undefined) {
      await dataSource.query(`UPDATE fee_generations SET generated_by_user_id = $1 WHERE id = $2`, [
        overrides.generated_by_user_id,
        batchId,
      ]);
    }
    return batchId;
  }

  async function createBill(
    batchId: string,
    studentId: string,
    overrides: { paid_amount?: number; status?: string } = {},
  ): Promise<string> {
    const res = await dataSource.query(
      `INSERT INTO student_fees (id, student_id, academic_year_id, month, year, total_amount, paid_amount, discount_amount, status, fee_generation_id, created_at, updated_at)
       VALUES (DEFAULT, $1, $2, 7, 2026, 1000, $3, 0, $4, $5, NOW(), NOW())
       RETURNING id`,
      [
        studentId,
        SEED_ACADEMIC_YEAR_ID,
        overrides.paid_amount ?? 0,
        overrides.status ?? 'PENDING',
        batchId,
      ],
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
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();

    dataSource = app.get(DataSource);

    await dataSource.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, 'Fee Generations Test School B', 'fee-generations-test-school-b', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [TENANT_B],
    );

    for (const role of [UserRole.ACCOUNTANT, UserRole.TEACHER, UserRole.STUDENT]) {
      await dataSource.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW())
         ON CONFLICT DO NOTHING`,
        [SEED_ADMIN_USER_ID, TENANT_ID, role],
      );
    }
    // Membership must exist before login — roles are embedded in the JWT
    // at login time, not re-queried per request (see ContextGuard), so a
    // tenant/role granted after this point would never be honored by a
    // token already issued.
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [SEED_ADMIN_USER_ID, TENANT_B, UserRole.ADMIN],
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

  describe('GET /fees/generations', () => {
    it('lists batches for the tenant, newest first', async () => {
      const batchId = await createBatch();

      const res = await supertest(app.getHttpServer())
        .get('/api/v1/fees/generations')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .expect(200);

      expect(res.body.data.some((b: any) => b.id === batchId)).toBe(true);
    });

    it('filters by source', async () => {
      const manualBatch = await createBatch({ source: 'MANUAL' });
      const scheduleBatch = await createBatch({ source: 'SCHEDULE' });

      const res = await supertest(app.getHttpServer())
        .get('/api/v1/fees/generations')
        .query({ source: 'SCHEDULE', limit: 100 })
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .expect(200);

      const ids = res.body.data.map((b: any) => b.id);
      expect(ids).toContain(scheduleBatch);
      expect(ids).not.toContain(manualBatch);
    });

    it('filters by generated_by_user_id', async () => {
      const batchId = await createBatch({ generated_by_user_id: SEED_ADMIN_USER_ID });
      const otherBatch = await createBatch({ generated_by_user_id: null });

      const res = await supertest(app.getHttpServer())
        .get('/api/v1/fees/generations')
        .query({ generated_by_user_id: SEED_ADMIN_USER_ID, limit: 100 })
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .expect(200);

      const ids = res.body.data.map((b: any) => b.id);
      expect(ids).toContain(batchId);
      expect(ids).not.toContain(otherBatch);
      const entry = res.body.data.find((b: any) => b.id === batchId);
      expect(entry.generated_by).toMatchObject({ id: SEED_ADMIN_USER_ID });
    });

    it('filters by period_from/period_to', async () => {
      const batchId = await createBatch();
      const res = await supertest(app.getHttpServer())
        .get('/api/v1/fees/generations')
        .query({ period_from: '2020-01-01', period_to: '2099-01-01', limit: 100 })
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .expect(200);
      expect(res.body.data.some((b: any) => b.id === batchId)).toBe(true);

      const noneRes = await supertest(app.getHttpServer())
        .get('/api/v1/fees/generations')
        .query({ period_from: '1900-01-01', period_to: '1901-01-01' })
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .expect(200);
      expect(noneRes.body.data.some((b: any) => b.id === batchId)).toBe(false);
    });

    it('computes collection_status NONE/PARTIAL/FULL correctly', async () => {
      const noneBatch = await createBatch();
      const noneStudent = await createStudent();
      await createBill(noneBatch, noneStudent, { paid_amount: 0, status: 'PENDING' });

      const partialBatch = await createBatch();
      const partialStudent = await createStudent();
      await createBill(partialBatch, partialStudent, {
        paid_amount: 400,
        status: 'PARTIALLY_PAID',
      });

      const fullBatch = await createBatch();
      const fullStudent = await createStudent();
      await createBill(fullBatch, fullStudent, { paid_amount: 1000, status: 'PAID' });

      const res = await supertest(app.getHttpServer())
        .get('/api/v1/fees/generations')
        .query({ limit: 200 })
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .expect(200);

      const byId = (id: string) => res.body.data.find((b: any) => b.id === id);
      expect(byId(noneBatch).collection_status).toBe('NONE');
      expect(byId(partialBatch).collection_status).toBe('PARTIAL');
      expect(byId(fullBatch).collection_status).toBe('FULL');

      const partialOnly = await supertest(app.getHttpServer())
        .get('/api/v1/fees/generations')
        .query({ collection_status: 'PARTIAL', limit: 200 })
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .expect(200);
      const partialIds = partialOnly.body.data.map((b: any) => b.id);
      expect(partialIds).toContain(partialBatch);
      expect(partialIds).not.toContain(noneBatch);
      expect(partialIds).not.toContain(fullBatch);

      // `total`/`totalPages` must reflect the collection_status-filtered set,
      // not the whole tenant's batch count — a real regression here is the
      // filter being applied to an already-paginated page instead of via
      // `HAVING`, which would leave `total` counting every batch while only
      // returning whichever `PARTIAL` rows happened to land on page 1.
      const partialSmallPage = await supertest(app.getHttpServer())
        .get('/api/v1/fees/generations')
        .query({ collection_status: 'PARTIAL', limit: 1, page: 1 })
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .expect(200);
      expect(partialSmallPage.body.data.length).toBe(1);
      expect(partialSmallPage.body.data[0].id).toBe(partialBatch);
      expect(partialSmallPage.body.total).toBe(partialOnly.body.data.length);
      expect(partialSmallPage.body.totalPages).toBe(Math.ceil(partialOnly.body.data.length / 1));
    });

    it("denies STUDENT role (not in the route's @Roles list)", async () => {
      await supertest(app.getHttpServer())
        .get('/api/v1/fees/generations')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.STUDENT)
        .expect(401);
    });

    it('returns 401 when X-Tenant-ID header is missing', async () => {
      await supertest(app.getHttpServer())
        .get('/api/v1/fees/generations')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Role', UserRole.ADMIN)
        .expect(401);
    });

    it('returns 401 for an invalid/unrecognized X-Tenant-ID', async () => {
      await supertest(app.getHttpServer())
        .get('/api/v1/fees/generations')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', '00000000-0000-4000-8000-000000000099')
        .set('X-Role', UserRole.ADMIN)
        .expect(401);
    });
  });

  describe('GET /fees/generations/:id', () => {
    it('returns one batch', async () => {
      const batchId = await createBatch();
      const res = await supertest(app.getHttpServer())
        .get(`/api/v1/fees/generations/${batchId}`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .expect(200);
      expect(res.body.id).toBe(batchId);
    });

    it('returns 404 for tenant B requesting tenant A batch', async () => {
      const batchId = await createBatch();

      await supertest(app.getHttpServer())
        .get(`/api/v1/fees/generations/${batchId}`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_B)
        .set('X-Role', UserRole.ADMIN)
        .expect(404);
    });
  });

  describe('GET /fees/generations/:id/bills', () => {
    it('returns paged bills with student detail', async () => {
      const batchId = await createBatch();
      const studentId = await createStudent();
      await createBill(batchId, studentId, { paid_amount: 200, status: 'PARTIALLY_PAID' });

      const res = await supertest(app.getHttpServer())
        .get(`/api/v1/fees/generations/${batchId}/bills`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .expect(200);

      const entry = res.body.data.find((b: any) => b.student_id === studentId);
      expect(entry).toBeDefined();
      expect(entry.paid_amount).toBe(200);
      expect(entry.status).toBe('PARTIALLY_PAID');
      expect(entry.occurrence).toBe('7/2026');
    });

    it('paginates', async () => {
      const batchId = await createBatch();
      for (let i = 0; i < 3; i += 1) {
        const studentId = await createStudent();
        await createBill(batchId, studentId);
      }

      const res = await supertest(app.getHttpServer())
        .get(`/api/v1/fees/generations/${batchId}/bills`)
        .query({ limit: 2, page: 1 })
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .expect(200);

      expect(res.body.data.length).toBe(2);
      expect(res.body.total).toBeGreaterThanOrEqual(3);
    });
  });
});
