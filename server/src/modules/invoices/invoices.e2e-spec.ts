import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { UserRole } from '@biddaloy/shared';
import { todayInSchoolTz } from '../../common/time';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_USER_ID,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
  SEED_SECTION_1_ID,
  SEED_ACADEMIC_YEAR_ID,
} from '@test/constants';
import { ensureFeeStructure, periodStart } from '@test/helpers/fee-fixture.helper';

// [78 D1] A distinct ADMIN who approves the MON-05 reversal below.
const REVERSE_APPROVER_ID = '00000000-0000-4000-8000-00000000a7d1';
const REVERSE_APPROVER_EMAIL = 'invoices-reverse-approver@e2e.example';

/**
 * E2E tests for the Invoice Generation & Printing API [16.5.1].
 *
 * Tests RBAC, tenant isolation, and the end-to-end shape of
 * POST /invoices, GET /invoices, GET /invoices/:id, GET /invoices/:id/print.
 *
 * `POST /invoices` no longer accepts free-form line items — an invoice is
 * always built from an already-recorded payment's committed allocations
 * (`{ payment_id }`), so every fixture here records a payment (and marks
 * its fee PAID) before asking the endpoint to generate the invoice.
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
      [
        `Invoice Student ${studentSeq}`,
        `REG-INV-E2E-${String(studentSeq).padStart(4, '0')}`,
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

  async function createFee(studentId: string, totalAmount = 1000): Promise<string> {
    const res = await dataSource.query(
      // 16.1.3: `month`/`year` are generated from `period_start`, and
      // `fee_structure_id` is NOT NULL.
      `INSERT INTO student_fees (id, student_id, academic_year_id, fee_structure_id, period_start, total_amount, paid_amount, discount_amount, status, created_at, updated_at)
       VALUES (DEFAULT, $1, $2, $3, $4::date, $5, 0, 0, 'PENDING', NOW(), NOW())
       RETURNING id`,
      [
        studentId,
        SEED_ACADEMIC_YEAR_ID,
        await ensureFeeStructure(dataSource),
        periodStart(5, 2026),
        totalAmount,
      ],
    );
    return res[0].id;
  }

  /** [16.5.1] Records a payment fully allocated against `feeId` and marks
   * the fee PAID — the state `InvoicesService.create` expects to build a
   * snapshot from. Mirrors what checkout/payment-allocation do before
   * ever calling the invoices endpoint. */
  async function createPayment(studentId: string, feeId: string, amount: number): Promise<string> {
    const paymentRes = await dataSource.query(
      `INSERT INTO payments (id, student_id, total_amount, payment_method, payment_status, received_by_user_id, payment_date, tenant_id, created_at, updated_at)
       VALUES (DEFAULT, $1, $2, 'CASH', 'SUCCESS', $3, NOW(), $4, NOW(), NOW())
       RETURNING id`,
      [studentId, amount, SEED_ADMIN_USER_ID, TENANT_ID],
    );
    const paymentId = paymentRes[0].id;
    await dataSource.query(
      `INSERT INTO payment_allocations (id, payment_id, student_fee_id, allocated_amount, allocation_type, created_at)
       VALUES (DEFAULT, $1, $2, $3, 'CURRENT', NOW())`,
      [paymentId, feeId, amount],
    );
    await dataSource.query(
      `UPDATE student_fees SET paid_amount = $1, status = 'PAID' WHERE id = $2`,
      [amount, feeId],
    );
    return paymentId;
  }

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL must be set to run e2e tests');
    }
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-production';
    process.env.NODE_ENV = 'test';
    // step-up OTP echoes the code only under this flag (real reversal e2e).
    process.env.ACCOUNT_ACCESS_ECHO_SECRETS = 'true';

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
    // [78 D1] The MON-05 reversal below must not self-approve: a second ADMIN
    // in the seed school (other specs add them) would make it a 403.
    await dataSource.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'Invoices Reverse E2E Approver', 'ACTIVE', NOW(), NOW())
       ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, status = 'ACTIVE'`,
      [REVERSE_APPROVER_ID, REVERSE_APPROVER_EMAIL, SEED_ADMIN_PASSWORD_HASH],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, 'ADMIN', NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [REVERSE_APPROVER_ID, TENANT_ID],
    );

    const loginRes = await supertest(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    token = loginRes.body.access_token;
    studentRoleToken = token;
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  describe('POST /invoices', () => {
    it('creates an invoice for ACCOUNTANT role from a payment_id', async () => {
      const studentId = await createStudent();
      const feeId = await createFee(studentId, 1200);
      const paymentId = await createPayment(studentId, feeId, 1200);

      const res = await supertest(app.getHttpServer())
        .post('/api/v1/invoices')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ACCOUNTANT)
        .send({ payment_id: paymentId })
        .expect(201);

      expect(res.body.invoice_number).toMatch(/^INV-\d{4}-\d{5}$/);
      expect(Number(res.body.total_amount)).toBe(1200);
      expect(res.body.status).toBe('ISSUED');
      expect(res.body.kind).toBe('INVOICE');
      expect(res.body.snapshot.students[0].id).toBe(studentId);
      // issued_by embeds the full User relation server-side — must never
      // carry password_hash into the response.
      expect(res.body.issued_by).not.toHaveProperty('password_hash');
    });

    it('[MON-05] returns 409 and writes no invoice for a reversal and for the reversed original', async () => {
      const studentId = await createStudent();
      const feeId = await createFee(studentId, 700);
      const originalId = await createPayment(studentId, feeId, 700);
      // Reversal state as PaymentReversalService leaves it: a REFUNDED row
      // pointing back at the original, and the original pointing at it.
      const rev = await dataSource.query(
        `INSERT INTO payments (id, student_id, total_amount, payment_method, payment_status, received_by_user_id, payment_date, tenant_id, reversal_of_payment_id, created_at, updated_at)
         VALUES (DEFAULT, $1, 700, 'CASH', 'REFUNDED', $2, NOW(), $3, $4, NOW(), NOW()) RETURNING id`,
        [studentId, SEED_ADMIN_USER_ID, TENANT_ID, originalId],
      );
      const reversalId = rev[0].id;
      await dataSource.query(`UPDATE payments SET reversed_by_payment_id = $1 WHERE id = $2`, [
        reversalId,
        originalId,
      ]);

      for (const id of [reversalId, originalId]) {
        const res = await supertest(app.getHttpServer())
          .post('/api/v1/invoices')
          .set('Authorization', `Bearer ${token}`)
          .set('X-Tenant-ID', TENANT_ID)
          .set('X-Role', UserRole.ACCOUNTANT)
          .send({ payment_id: id })
          .expect(409);
        expect(res.body.details.code).toBe('INVOICE_PAYMENT_NOT_INVOICEABLE');
      }
      const rows = await dataSource.query(
        `SELECT id FROM invoices WHERE payment_id = ANY($1::uuid[])`,
        [[reversalId, originalId]],
      );
      expect(rows).toHaveLength(0);
    });

    it('[MON-05] real flow: invoice, reverse via API, then POST /invoices for both ids is 409 with no new row', async () => {
      const studentId = await createStudent();
      const feeId = await createFee(studentId, 800);
      const originalId = await createPayment(studentId, feeId, 800);
      const post = (id: string) =>
        supertest(app.getHttpServer())
          .post('/api/v1/invoices')
          .set('Authorization', `Bearer ${token}`)
          .set('X-Tenant-ID', TENANT_ID)
          .set('X-Role', UserRole.ACCOUNTANT)
          .send({ payment_id: id });
      await post(originalId).expect(201);

      const otpRes = await supertest(app.getHttpServer())
        .post('/api/v1/auth/step-up/otp/request')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ identifier: REVERSE_APPROVER_EMAIL, scope: 'payments.reverse' })
        .expect(202);
      const verifyRes = await supertest(app.getHttpServer())
        .post('/api/v1/auth/step-up')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({
          identifier: REVERSE_APPROVER_EMAIL,
          method: 'OTP',
          otp: otpRes.body.debug?.otp,
          scope: 'payments.reverse',
        })
        .expect(200);
      const revRes = await supertest(app.getHttpServer())
        .post(`/api/v1/payments/${originalId}/reverse`)
        .send({ reason: 'MON-05 e2e' })
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .set('X-Approval-Token', verifyRes.body.approval_token)
        .expect(200);
      const reversalId = revRes.body.id;

      const before = await dataSource.query(`SELECT count(*)::int AS n FROM invoices`);
      for (const id of [reversalId, originalId]) {
        const res = await post(id).expect(409);
        expect(res.body.details.code).toBe('INVOICE_PAYMENT_NOT_INVOICEABLE');
      }
      const after = await dataSource.query(`SELECT count(*)::int AS n FROM invoices`);
      expect(after[0].n).toBe(before[0].n);
    });

    it('returns 403 for STUDENT role', async () => {
      const studentId = await createStudent();
      const feeId = await createFee(studentId);
      const paymentId = await createPayment(studentId, feeId, 1000);

      const res = await supertest(app.getHttpServer())
        .post('/api/v1/invoices')
        .set('Authorization', `Bearer ${studentRoleToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.STUDENT)
        .send({ payment_id: paymentId })
        .expect(403);

      expect(res.body.message).toContain('Requires permission(s)');
    });

    it('returns 404 when payment does not exist', async () => {
      await supertest(app.getHttpServer())
        .post('/api/v1/invoices')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .send({ payment_id: '00000000-0000-4000-8000-000000000000' })
        .expect(404);
    });

    it('returns 400 for invalid DTO (missing payment_id)', async () => {
      await supertest(app.getHttpServer())
        .post('/api/v1/invoices')
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
      const paymentId = await createPayment(studentId, feeId, 900);

      const createRes = await supertest(app.getHttpServer())
        .post('/api/v1/invoices')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ACCOUNTANT)
        .send({ payment_id: paymentId })
        .expect(201);

      const detailRes = await supertest(app.getHttpServer())
        .get(`/api/v1/invoices/${createRes.body.id}`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .expect(200);
      expect(detailRes.body.id).toBe(createRes.body.id);
      expect(detailRes.body.issued_by).not.toHaveProperty('password_hash');

      const printRes = await supertest(app.getHttpServer())
        .get(`/api/v1/invoices/${createRes.body.id}/print`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .expect(200);
      expect(printRes.headers['content-type']).toContain('text/html');
      expect(printRes.text).toContain(createRes.body.invoice_number);
    });

    it('[2638] stays readable, listed and printable after the student is deleted', async () => {
      const studentId = await createStudent();
      const feeId = await createFee(studentId, 900);
      const paymentId = await createPayment(studentId, feeId, 900); // paid in full: nothing owed
      const createRes = await supertest(app.getHttpServer())
        .post('/api/v1/invoices')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ACCOUNTANT)
        .send({ payment_id: paymentId })
        .expect(201);
      await supertest(app.getHttpServer())
        .delete(`/api/v1/students/${studentId}`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .expect(200);

      const get = (path: string) =>
        supertest(app.getHttpServer())
          .get(path)
          .set('Authorization', `Bearer ${token}`)
          .set('X-Tenant-ID', TENANT_ID)
          .set('X-Role', UserRole.ADMIN);
      await get(`/api/v1/invoices/${createRes.body.id}`).expect(200);
      await get(`/api/v1/invoices/${createRes.body.id}/print`).expect(200);
      const list = await get('/api/v1/invoices')
        .query({ search: createRes.body.invoice_number })
        .expect(200);
      expect(list.body.data.map((i: { id: string }) => i.id)).toContain(createRes.body.id);
    });

    it('[16.5.2] renders pos58/pos80 when asked, and 400s on an unknown format', async () => {
      const studentId = await createStudent();
      const feeId = await createFee(studentId, 500);
      const paymentId = await createPayment(studentId, feeId, 500);

      const createRes = await supertest(app.getHttpServer())
        .post('/api/v1/invoices')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ACCOUNTANT)
        .send({ payment_id: paymentId })
        .expect(201);

      const pos58Res = await supertest(app.getHttpServer())
        .get(`/api/v1/invoices/${createRes.body.id}/print?format=pos58`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .expect(200);
      expect(pos58Res.text).toContain('@page { size: 58mm auto; margin: 2mm }');

      const pos80Res = await supertest(app.getHttpServer())
        .get(`/api/v1/invoices/${createRes.body.id}/print?format=pos80`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .expect(200);
      expect(pos80Res.text).toContain('@page { size: 80mm auto; margin: 2mm }');

      await supertest(app.getHttpServer())
        .get(`/api/v1/invoices/${createRes.body.id}/print?format=pdf`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .expect(400);
    });

    it('returns 404 for an invoice that does not exist', async () => {
      await supertest(app.getHttpServer())
        .get('/api/v1/invoices/00000000-0000-4000-8000-000000000000')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .expect(404);
    });

    it('returns 400 (not a DB error) for a malformed id', async () => {
      await supertest(app.getHttpServer())
        .get('/api/v1/invoices/not-a-uuid')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .expect(400);

      await supertest(app.getHttpServer())
        .get('/api/v1/invoices/not-a-uuid/print')
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
      const paymentId = await createPayment(studentId, feeId, 1000);
      await supertest(app.getHttpServer())
        .post('/api/v1/invoices')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ACCOUNTANT)
        .send({ payment_id: paymentId })
        .expect(201);

      const res = await supertest(app.getHttpServer())
        .get('/api/v1/invoices')
        .query({ student_id: studentId })
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .expect(200);

      expect(res.body.total).toBe(1);
      expect(res.body.data[0].student_id).toBe(studentId);
    });
  });

  describe('per-school numbering (TEN-04)', () => {
    const OTHER_TENANT = '00000000-0000-4000-8000-0000000000a4';

    it('the migrated immutability trigger rejects moving an issued invoice to another school', async () => {
      await dataSource.query(
        `INSERT INTO schools (id, name, slug, created_at, updated_at)
         VALUES ($1, 'Other School', 'other-school-ten04', NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [OTHER_TENANT],
      );
      const studentId = await createStudent();
      const paymentId = await createPayment(studentId, await createFee(studentId), 1000);
      const res = await supertest(app.getHttpServer())
        .post('/api/v1/invoices')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ACCOUNTANT)
        .send({ payment_id: paymentId })
        .expect(201);
      // Runs on the migrated DB, so this exercises the migration's trigger body, not a test copy.
      await expect(
        dataSource.query(`UPDATE invoices SET tenant_id = $1 WHERE id = $2`, [
          OTHER_TENANT,
          res.body.id,
        ]),
      ).rejects.toThrow(/immutable/);
    });

    it("another school's INV-<yr>-99999 does not wedge this school's numbering or its list", async () => {
      await dataSource.query(
        `INSERT INTO schools (id, name, slug, created_at, updated_at)
         VALUES ($1, 'Other School', 'other-school-ten04', NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [OTHER_TENANT],
      );
      const otherStudent = await dataSource.query(
        `INSERT INTO students (id, full_name, registration_number, roll_number, class_section_id, tenant_id, date_of_birth, preferred_communication, enrollment_status, created_at, updated_at)
         VALUES (DEFAULT, 'Other Student', 'REG-TEN04-OTHER', 1, $1, $2, '2010-01-01', 'SMS', 'ACTIVE', NOW(), NOW())
         RETURNING id`,
        [SEED_SECTION_1_ID, OTHER_TENANT],
      );
      const foreignNumber = `INV-${todayInSchoolTz().slice(0, 4)}-99999`;
      await dataSource.query(
        `INSERT INTO invoices (invoice_number, tenant_id, student_id, total_amount, tax_amount, discount_amount, status, kind, issued_date, due_date, snapshot, created_at, updated_at)
         VALUES ($1, $2, $3, 1, 0, 0, 'ISSUED', 'INVOICE', '2026-01-01', '2026-01-31', '{}', NOW(), NOW())`,
        [foreignNumber, OTHER_TENANT, otherStudent[0].id],
      );

      const numbers: string[] = [];
      for (let i = 0; i < 2; i++) {
        const studentId = await createStudent();
        const paymentId = await createPayment(studentId, await createFee(studentId), 1000);
        const res = await supertest(app.getHttpServer())
          .post('/api/v1/invoices')
          .set('Authorization', `Bearer ${token}`)
          .set('X-Tenant-ID', TENANT_ID)
          .set('X-Role', UserRole.ACCOUNTANT)
          .send({ payment_id: paymentId })
          .expect(201);
        numbers.push(res.body.invoice_number);
      }
      expect(numbers[0]).not.toBe(numbers[1]);
      expect(numbers).not.toContain(foreignNumber);
      expect(numbers.every((n) => !n.endsWith('-100000'))).toBe(true);

      const list = await supertest(app.getHttpServer())
        .get('/api/v1/invoices')
        .query({ limit: 100 })
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .expect(200);
      // Tenant isolation: the other school's invoice is never listed here.
      expect(list.body.data.map((i: { invoice_number: string }) => i.invoice_number)).not.toContain(
        foreignNumber,
      );
    });
  });

  describe('POST /invoices/:id/send with Idempotency-Key [#2692]', () => {
    it('the same key twice gives the same reply and sends ONE message', async () => {
      const studentId = await createStudent();
      const guardianRes = await dataSource.query(
        `INSERT INTO guardians (id, full_name, relationship, phone, preferred_communication, is_primary_contact, tenant_id, created_at, updated_at)
         VALUES (DEFAULT, 'Idem Invoice Parent', 'FATHER', '01712345678', 'SMS', true, $1, NOW(), NOW())
         RETURNING id`,
        [TENANT_ID],
      );
      const guardianId = guardianRes[0].id;
      await dataSource.query(
        `INSERT INTO student_guardians (student_id, guardian_id) VALUES ($1, $2)`,
        [studentId, guardianId],
      );
      const feeId = await createFee(studentId, 900);
      const paymentId = await createPayment(studentId, feeId, 900);
      const created = await supertest(app.getHttpServer())
        .post('/api/v1/invoices')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ACCOUNTANT)
        .send({ payment_id: paymentId })
        .expect(201);

      const key = `inv-send-${randomUUID()}`;
      const send = () =>
        supertest(app.getHttpServer())
          .post(`/api/v1/invoices/${created.body.id}/send`)
          .set('Authorization', `Bearer ${token}`)
          .set('X-Tenant-ID', TENANT_ID)
          .set('X-Role', UserRole.ACCOUNTANT)
          .set('Idempotency-Key', key)
          .send({ medium: 'SMS', guardian_id: guardianId });

      const first = await send().expect(201);
      const second = await send().expect(201);

      expect(second.body).toEqual(first.body);
      const rows = await dataSource.query(
        `SELECT count(*)::int AS n FROM communication_logs WHERE tenant_id = $1 AND guardian_id = $2`,
        [TENANT_ID, guardianId],
      );
      expect(rows[0].n).toBe(1);
    });
  });
});
