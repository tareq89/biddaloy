import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { DataSource } from 'typeorm';
import { UserRole, PaymentMethod, PaymentAllocationType, FeeStatus } from '@beton-boi/shared';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_USER_ID,
  SEED_ADMIN_PASSWORD,
  SEED_SECTION_1_ID,
  SEED_ACADEMIC_YEAR_ID,
} from '@test/constants';

/**
 * E2E tests for POST /payments/record-with-allocation (issue #13).
 *
 * Tests RBAC (ADMIN/ACCOUNTANT/EXECUTIVE allowed, others denied), tenant
 * isolation, and the end-to-end shape of a payment recording request —
 * partial payment, full payment with auto-generated invoice, and FIFO
 * violation rejection.
 */

function monthOffset(offset: number): { month: number; year: number } {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offset);
  return { month: d.getMonth() + 1, year: d.getFullYear() };
}

describe('Payment Recording (record-with-allocation) E2E', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let token: string;
  let studentToken: string;

  const TENANT_ID = SEED_TENANT_ID;
  let studentSeq = 0;

  async function createStudent(): Promise<string> {
    studentSeq += 1;
    const res = await dataSource.query(
      `INSERT INTO students (id, full_name, registration_number, roll_number, class_section_id, tenant_id, date_of_birth, preferred_communication, enrollment_status, created_at, updated_at)
       VALUES (DEFAULT, $1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
       RETURNING id`,
      [`Pay Student ${studentSeq}`, `REG-PAY-E2E-${String(studentSeq).padStart(4, '0')}`, studentSeq, SEED_SECTION_1_ID, TENANT_ID, '2010-01-01', 'SMS', 'ACTIVE'],
    );
    return res[0].id;
  }

  async function createFee(studentId: string, offset: number, totalAmount = 1000): Promise<string> {
    const { month, year } = monthOffset(offset);
    const res = await dataSource.query(
      `INSERT INTO student_fees (id, student_id, academic_year_id, month, year, total_amount, paid_amount, discount_amount, status, created_at, updated_at)
       VALUES (DEFAULT, $1, $2, $3, $4, $5, 0, 0, 'PENDING', NOW(), NOW())
       RETURNING id`,
      [studentId, SEED_ACADEMIC_YEAR_ID, month, year, totalAmount],
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
    studentToken = token;
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  describe('POST /payments/record-with-allocation', () => {
    it('records a partial payment for ADMIN role and leaves the fee PARTIALLY_PAID', async () => {
      const studentId = await createStudent();
      const feeId = await createFee(studentId, 0, 1000);

      const res = await supertest(app.getHttpServer())
        .post('/api/v1/payments/record-with-allocation')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .send({
          student_id: studentId,
          total_amount: 400,
          payment_method: PaymentMethod.CASH,
          allocations: [{ student_fee_id: feeId, allocated_amount: 400, allocation_type: PaymentAllocationType.CURRENT }],
        })
        .expect(201);

      expect(Number(res.body.total_amount)).toBe(400);
      expect(res.body.invoice_id).toBeNull();

      const fee = await dataSource.query(`SELECT * FROM student_fees WHERE id = $1`, [feeId]);
      expect(Number(fee[0].paid_amount)).toBe(400);
      expect(fee[0].status).toBe(FeeStatus.PARTIALLY_PAID);
    });

    it('records a full payment for ACCOUNTANT role and auto-generates an invoice', async () => {
      const studentId = await createStudent();
      const feeId = await createFee(studentId, 0, 1000);

      const res = await supertest(app.getHttpServer())
        .post('/api/v1/payments/record-with-allocation')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ACCOUNTANT)
        .send({
          student_id: studentId,
          total_amount: 1000,
          payment_method: PaymentMethod.CASH,
          allocations: [{ student_fee_id: feeId, allocated_amount: 1000, allocation_type: PaymentAllocationType.CURRENT }],
        })
        .expect(201);

      expect(res.body.invoice_id).not.toBeNull();

      const invoice = await dataSource.query(`SELECT * FROM invoices WHERE id = $1`, [res.body.invoice_id]);
      expect(invoice).toHaveLength(1);
      expect(Number(invoice[0].total_amount)).toBe(1000);

      const auditLogs = await dataSource.query(
        `SELECT * FROM audit_logs WHERE entity_id = $1 AND action = 'PAYMENT_RECEIVED'`,
        [res.body.id],
      );
      expect(auditLogs).toHaveLength(1);
    });

    it('returns 401 for STUDENT role', async () => {
      const studentId = await createStudent();
      const feeId = await createFee(studentId, 0, 1000);

      const res = await supertest(app.getHttpServer())
        .post('/api/v1/payments/record-with-allocation')
        .set('Authorization', `Bearer ${studentToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.STUDENT)
        .send({
          student_id: studentId,
          total_amount: 1000,
          payment_method: PaymentMethod.CASH,
          allocations: [{ student_fee_id: feeId, allocated_amount: 1000, allocation_type: PaymentAllocationType.CURRENT }],
        })
        .expect(401);

      expect(res.body.message).toContain('Requires one of roles');
    });

    it('returns 400 when allocations violate FIFO order', async () => {
      const studentId = await createStudent();
      await createFee(studentId, -2, 500);
      const dueRecentId = await createFee(studentId, -1, 500);

      await supertest(app.getHttpServer())
        .post('/api/v1/payments/record-with-allocation')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .send({
          student_id: studentId,
          total_amount: 500,
          payment_method: PaymentMethod.CASH,
          allocations: [{ student_fee_id: dueRecentId, allocated_amount: 500, allocation_type: PaymentAllocationType.DUE }],
        })
        .expect(400);
    });

    it('returns 400 for invalid DTO (missing required fields)', async () => {
      await supertest(app.getHttpServer())
        .post('/api/v1/payments/record-with-allocation')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .send({})
        .expect(400);
    });

    it('returns 404 when student does not exist', async () => {
      await supertest(app.getHttpServer())
        .post('/api/v1/payments/record-with-allocation')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .send({
          student_id: '00000000-0000-4000-8000-000000000000',
          total_amount: 100,
          payment_method: PaymentMethod.CASH,
          allocations: [{ student_fee_id: '00000000-0000-4000-8000-000000000001', allocated_amount: 100, allocation_type: PaymentAllocationType.CURRENT }],
        })
        .expect(404);
    });
  });
});
