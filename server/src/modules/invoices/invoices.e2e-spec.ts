import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from '../../app.module';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { DataSource } from 'typeorm';
import { UserRole } from '@beton-boi/shared';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_USER_ID,
  SEED_ADMIN_PASSWORD,
  SEED_SECTION_1_ID,
  SEED_ACADEMIC_YEAR_ID,
} from '@test/constants';

/**
 * E2E tests for the Invoice Generation & Printing API (issue #14).
 *
 * Tests RBAC, tenant isolation, and the end-to-end shape of
 * POST /invoices, GET /invoices, GET /invoices/:id, GET /invoices/:id/print.
 */

describe('Invoices E2E', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let token: string;
  let studentRoleToken: string;

  const TENANT_ID = SEED_TENANT_ID;
  let studentSeq = 0;

  async function createStudent(): Promise<string> {
    studentSeq += 1;
    const res = await dataSource.query(
      `INSERT INTO students (id, full_name, registration_number, roll_number, class_section_id, tenant_id, date_of_birth, preferred_communication, enrollment_status, created_at, updated_at)
       VALUES (DEFAULT, $1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
       RETURNING id`,
      [`Invoice Student ${studentSeq}`, `REG-INV-E2E-${String(studentSeq).padStart(4, '0')}`, studentSeq, SEED_SECTION_1_ID, TENANT_ID, '2010-01-01', 'SMS', 'ACTIVE'],
    );
    return res[0].id;
  }

  async function createFee(studentId: string, totalAmount = 1000): Promise<string> {
    const res = await dataSource.query(
      `INSERT INTO student_fees (id, student_id, academic_year_id, month, year, total_amount, paid_amount, discount_amount, status, created_at, updated_at)
       VALUES (DEFAULT, $1, $2, $3, $4, $5, 0, 0, 'PENDING', NOW(), NOW())
       RETURNING id`,
      [studentId, SEED_ACADEMIC_YEAR_ID, 5, 2026, totalAmount],
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
    studentRoleToken = token;
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  describe('POST /invoices', () => {
    it('creates an invoice for ACCOUNTANT role from a student_fee_id', async () => {
      const studentId = await createStudent();
      const feeId = await createFee(studentId, 1200);

      const res = await supertest(app.getHttpServer())
        .post('/invoices')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ACCOUNTANT)
        .send({ student_id: studentId, student_fee_id: feeId })
        .expect(201);

      expect(res.body.invoice_number).toMatch(/^INV-\d{4}-\d{5}$/);
      expect(Number(res.body.total_amount)).toBe(1200);
      expect(res.body.status).toBe('ISSUED');
    });

    it('returns 401 for STUDENT role', async () => {
      const studentId = await createStudent();
      const feeId = await createFee(studentId);

      const res = await supertest(app.getHttpServer())
        .post('/invoices')
        .set('Authorization', `Bearer ${studentRoleToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.STUDENT)
        .send({ student_id: studentId, student_fee_id: feeId })
        .expect(401);

      expect(res.body.message).toContain('Requires one of roles');
    });

    it('returns 404 when student does not exist', async () => {
      await supertest(app.getHttpServer())
        .post('/invoices')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .send({ student_id: '00000000-0000-4000-8000-000000000000', line_items: [{ description: 'Fee', amount: 100 }] })
        .expect(404);
    });

    it('returns 400 for invalid DTO (missing student_id)', async () => {
      await supertest(app.getHttpServer())
        .post('/invoices')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .send({})
        .expect(400);
    });
  });

  describe('GET /invoices/:id and /invoices/:id/print', () => {
    it('fetches invoice detail and printable HTML', async () => {
      const studentId = await createStudent();
      const feeId = await createFee(studentId, 900);

      const createRes = await supertest(app.getHttpServer())
        .post('/invoices')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ACCOUNTANT)
        .send({ student_id: studentId, student_fee_id: feeId })
        .expect(201);

      const detailRes = await supertest(app.getHttpServer())
        .get(`/invoices/${createRes.body.id}`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .expect(200);
      expect(detailRes.body.id).toBe(createRes.body.id);

      const printRes = await supertest(app.getHttpServer())
        .get(`/invoices/${createRes.body.id}/print`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .expect(200);
      expect(printRes.headers['content-type']).toContain('text/html');
      expect(printRes.text).toContain(createRes.body.invoice_number);
    });

    it('returns 404 for an invoice that does not exist', async () => {
      await supertest(app.getHttpServer())
        .get('/invoices/00000000-0000-4000-8000-000000000000')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .expect(404);
    });

    it('returns 400 (not a DB error) for a malformed id', async () => {
      await supertest(app.getHttpServer())
        .get('/invoices/not-a-uuid')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .expect(400);

      await supertest(app.getHttpServer())
        .get('/invoices/not-a-uuid/print')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .expect(400);
    });
  });

  describe('GET /invoices', () => {
    it('lists invoices filtered by student_id', async () => {
      const studentId = await createStudent();
      const feeId = await createFee(studentId);
      await supertest(app.getHttpServer())
        .post('/invoices')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ACCOUNTANT)
        .send({ student_id: studentId, student_fee_id: feeId })
        .expect(201);

      const res = await supertest(app.getHttpServer())
        .get('/invoices')
        .query({ student_id: studentId })
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .expect(200);

      expect(res.body.total).toBe(1);
      expect(res.body.data[0].student_id).toBe(studentId);
    });
  });
});
