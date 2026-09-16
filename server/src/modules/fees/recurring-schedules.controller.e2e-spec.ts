import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UserRole } from '@biddaloy/shared';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_USER_ID,
  SEED_ADMIN_PASSWORD,
  SEED_SECTION_1_ID,
  SEED_ACADEMIC_YEAR_ID,
} from '@test/constants';

/** [16.7.1] E2E tests for the recurring-schedules routes. */
describe('Recurring Schedules E2E', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let adminToken: string;
  let teacherToken: string;

  const TENANT_ID = SEED_TENANT_ID;

  async function createFeeStructure(): Promise<string> {
    const res = await dataSource.query(
      `INSERT INTO fee_structures (id, fee_type, name, amount, academic_year_id, tenant_id, created_at, updated_at)
       VALUES (DEFAULT, 'MONTHLY_TUITION', $1, 1000, $2, $3, NOW(), NOW())
       RETURNING id`,
      [`E2E Tuition ${Date.now()}`, SEED_ACADEMIC_YEAR_ID, TENANT_ID],
    );
    return res[0].id as string;
  }

  function createSchedule(token: string, feeStructureId: string) {
    return supertest(app.getHttpServer())
      .post('/api/v1/fees/schedules')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', TENANT_ID)
      .set('X-Role', UserRole.ADMIN)
      .send({
        academic_year_id: SEED_ACADEMIC_YEAR_ID,
        name: `E2E Schedule ${Date.now()}`,
        audience: { section_id: SEED_SECTION_1_ID, enrollment_status: 'ACTIVE' },
        rule: { kind: 'MONTHLY', day_of_month: 1 },
        fee_structure_ids: [feeStructureId],
        starts_on: '2026-01-01',
      });
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

    for (const role of [UserRole.TEACHER]) {
      await dataSource.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW())
         ON CONFLICT DO NOTHING`,
        [SEED_ADMIN_USER_ID, TENANT_ID, role],
      );
    }

    const adminLogin = await supertest(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    adminToken = adminLogin.body.access_token;
    teacherToken = adminToken;
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  describe('permissions', () => {
    it('denies POST /fees/schedules to a TEACHER (401 — role not in @Roles list)', async () => {
      const feeStructureId = await createFeeStructure();

      await supertest(app.getHttpServer())
        .post('/api/v1/fees/schedules')
        .set('Authorization', `Bearer ${teacherToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.TEACHER)
        .send({
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
          name: 'Denied schedule',
          audience: { enrollment_status: 'ACTIVE' },
          rule: { kind: 'MONTHLY', day_of_month: 1 },
          fee_structure_ids: [feeStructureId],
          starts_on: '2026-01-01',
        })
        .expect(401);
    });

    it('allows a TEACHER to read GET /fees/schedules (FEE_READ)', async () => {
      await supertest(app.getHttpServer())
        .get('/api/v1/fees/schedules')
        .set('Authorization', `Bearer ${teacherToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.TEACHER)
        .expect(200);
    });
  });

  describe('GET /fees/schedules/:id/preview', () => {
    it('returns the resolved audience for an ADMIN caller', async () => {
      const feeStructureId = await createFeeStructure();
      const createRes = await createSchedule(adminToken, feeStructureId).expect(201);

      const res = await supertest(app.getHttpServer())
        .get(`/api/v1/fees/schedules/${createRes.body.id}/preview`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .expect(200);

      expect(res.body).toHaveProperty('total_count');
      expect(res.body).toHaveProperty('students');
      expect(Array.isArray(res.body.students)).toBe(true);
    });
  });
});
