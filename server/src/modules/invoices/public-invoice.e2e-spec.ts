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
import { ensureFeeStructure, periodStart } from '@test/helpers/fee-fixture.helper';
import { PUBLIC_INVOICE_RATE_LIMIT } from '../../rate-limit';

/**
 * E2E tests for the public share-link surface [#666]:
 * `POST/GET/DELETE /invoices/:id/share` (authenticated) and
 * `GET /public/invoices/:token` (no auth, no tenant header).
 */
describe('Public Invoice Share E2E', () => {
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
        `Share Student ${studentSeq}`,
        `REG-SHARE-E2E-${String(studentSeq).padStart(4, '0')}`,
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
      `INSERT INTO student_fees (id, student_id, academic_year_id, fee_structure_id, period_start, total_amount, paid_amount, discount_amount, status, created_at, updated_at)
       VALUES (DEFAULT, $1, $2, $3, $4::date, $5, 0, 0, 'PENDING', NOW(), NOW())
       RETURNING id`,
      [
        studentId,
        SEED_ACADEMIC_YEAR_ID,
        await ensureFeeStructure(dataSource),
        periodStart(6, 2026),
        totalAmount,
      ],
    );
    return res[0].id;
  }

  async function createPayment(studentId: string, feeId: string, amount: number): Promise<string> {
    const paymentRes = await dataSource.query(
      `INSERT INTO payments (id, student_id, total_amount, payment_method, payment_status, received_by_user_id, transaction_reference, payment_date, tenant_id, created_at, updated_at)
       VALUES (DEFAULT, $1, $2, 'BKASH', 'SUCCESS', $3, $4, NOW(), $5, NOW(), NOW())
       RETURNING id`,
      [studentId, amount, SEED_ADMIN_USER_ID, 'TXN1234567890', TENANT_ID],
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

  /** Creates a fully paid invoice via the real POST /invoices endpoint and
   * returns its id. */
  async function createInvoice(): Promise<string> {
    const studentId = await createStudent();
    const feeId = await createFee(studentId, 1500);
    const paymentId = await createPayment(studentId, feeId, 1500);
    const res = await supertest(app.getHttpServer())
      .post('/api/v1/invoices')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', TENANT_ID)
      .set('X-Role', UserRole.ACCOUNTANT)
      .send({ payment_id: paymentId })
      .expect(201);
    return res.body.id;
  }

  function extractToken(url: string): string {
    return url.split('/').pop()!;
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
    // [666] Also granted PARENT on the same user/tenant — membership rows
    // are baked into the JWT at login, so this must exist BEFORE `login`
    // runs for the "PARENT can't mint a share link" 403 test below to be
    // able to select PARENT via `X-Role` at all.
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [SEED_ADMIN_USER_ID, TENANT_ID, UserRole.PARENT],
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

  describe('POST/GET/DELETE /invoices/:id/share', () => {
    it('mints a share link and lists it without exposing token_hash', async () => {
      const invoiceId = await createInvoice();

      const shareRes = await supertest(app.getHttpServer())
        .post(`/api/v1/invoices/${invoiceId}/share`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ACCOUNTANT)
        .expect(201);

      expect(shareRes.body.url).toMatch(/\/i\/[A-Za-z0-9_-]+$/);
      expect(shareRes.body.token_id).toBeDefined();

      const listRes = await supertest(app.getHttpServer())
        .get(`/api/v1/invoices/${invoiceId}/share`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ACCOUNTANT)
        .expect(200);

      expect(listRes.body).toHaveLength(1);
      expect(listRes.body[0]).not.toHaveProperty('token_hash');
    });

    it('revoking a token makes the public link 404', async () => {
      const invoiceId = await createInvoice();
      const shareRes = await supertest(app.getHttpServer())
        .post(`/api/v1/invoices/${invoiceId}/share`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ACCOUNTANT)
        .expect(201);
      const rawToken = extractToken(shareRes.body.url);

      await supertest(app.getHttpServer()).get(`/api/v1/public/invoices/${rawToken}`).expect(200);

      await supertest(app.getHttpServer())
        .delete(`/api/v1/invoices/${invoiceId}/share/${shareRes.body.token_id}`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ACCOUNTANT)
        .expect(200);

      await supertest(app.getHttpServer()).get(`/api/v1/public/invoices/${rawToken}`).expect(404);
    });

    it('refuses a PARENT (holds INVOICE_READ, but not ADMIN/ACCOUNTANT) from minting a share link', async () => {
      // PARENT/STUDENT/SUPER_ADMIN all hold `INVOICE_READ` in
      // ROLE_PERMISSIONS, so `PermissionsGuard` alone would let a PARENT
      // through — the `@Roles(ADMIN, ACCOUNTANT)` narrowing on this route
      // is the ONLY thing stopping a guardian from minting an
      // unauthenticated public link for their own invoice. Without this
      // test, a regression here (e.g. someone widening the role list to
      // "anything with INVOICE_READ") would pass every other check in
      // this file silently. (PARENT membership granted in `beforeAll`.)
      // 401, not 403: this codebase's role-mismatch guard
      // (`context.guard.ts`'s role check) throws `UnauthorizedException`
      // on a `@Roles()` mismatch — `ForbiddenException`/403 is reserved
      // for `PermissionsGuard`'s missing-permission case, which doesn't
      // apply here since PARENT does hold `INVOICE_READ`.
      const invoiceId = await createInvoice();

      await supertest(app.getHttpServer())
        .post(`/api/v1/invoices/${invoiceId}/share`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.PARENT)
        .expect(401);
    });
  });

  describe('GET /public/invoices/:token', () => {
    it('works with no Authorization header and no X-Tenant-ID header', async () => {
      const invoiceId = await createInvoice();
      const shareRes = await supertest(app.getHttpServer())
        .post(`/api/v1/invoices/${invoiceId}/share`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ACCOUNTANT)
        .expect(201);
      const rawToken = extractToken(shareRes.body.url);

      const res = await supertest(app.getHttpServer())
        .get(`/api/v1/public/invoices/${rawToken}`)
        .expect(200);

      expect(res.body).not.toHaveProperty('received_by');
      expect(res.body).not.toHaveProperty('remarks');
      expect(res.body).not.toHaveProperty('notes');
      // Payment reference is redacted to its last 4 characters only.
      // 'TXN1234567890' is 13 chars — 9 redacted + last 4 kept.
      expect(res.body.payment.reference_last4).toBe('*********7890');
      expect(res.body.students[0]).not.toHaveProperty('registration_number');
      expect(res.body.invoice_number).toMatch(/^INV-\d{4}-\d{5}$/);
    });

    it('an unknown token 404s', async () => {
      await supertest(app.getHttpServer())
        .get('/api/v1/public/invoices/does-not-exist-at-all')
        .expect(404);
    });

    // The full e2e stack globally disables throttling when NODE_ENV=test
    // (see app.module.ts's ThrottlerModule.forRootAsync `skipIf` — the
    // whole e2e suite would otherwise flake on the *default* tier's limit
    // from sheer request volume, not on anything a given test checks). No
    // other route in this codebase has a real 429 e2e test for the same
    // reason — the tier's numbers are asserted directly instead, and the
    // route's `@Throttle({ default: PUBLIC_INVOICE_RATE_LIMIT })` wiring
    // is exercised structurally by every other test in this file actually
    // reaching the controller.
    it('is wired to the 30/min PUBLIC_INVOICE_RATE_LIMIT tier', () => {
      expect(PUBLIC_INVOICE_RATE_LIMIT).toEqual({ limit: 30, ttl: 60_000 });
    });
  });
});
