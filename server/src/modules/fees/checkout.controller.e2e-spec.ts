import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { PaymentMethod, UserRole } from '@biddaloy/shared';
import { randomUUID } from 'crypto';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
  SEED_SECTION_1_ID,
} from '@test/constants';
import { ensureFeeStructure, periodStart } from '@test/helpers/fee-fixture.helper';

/**
 * E2E tests for `GET /payments/cart` (16.4.1).
 *
 * Covers what the route itself is responsible for on top of
 * `CheckoutCartService` (already covered by the integration spec): the
 * `FEE_READ` gate, tenant isolation, and the family-caller 403 when any
 * requested `student_id` is not one of their own linked children.
 */

const API = '/api/v1';

const PARENT_USER_ID = '00000000-0000-4000-8000-0000006d0010';
const PARENT_EMAIL = 'checkout-parent@e2e.example';

describe('GET /payments/cart (16.4.1)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  let adminToken: string;
  let parentToken: string;

  let structureId: string;
  let studentSeq = 0;

  async function login(email: string): Promise<string> {
    const res = await supertest(app.getHttpServer())
      .post(`${API}/auth/login`)
      .send({ email, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    return res.body.access_token;
  }

  async function createStudent(): Promise<string> {
    studentSeq += 1;
    const res = await dataSource.query(
      `INSERT INTO students (id, full_name, registration_number, roll_number, class_section_id, tenant_id, date_of_birth, preferred_communication, enrollment_status, created_at, updated_at)
       VALUES (DEFAULT, $1, $2, $3, $4, $5, '2010-01-01', 'SMS', 'ACTIVE', NOW(), NOW())
       RETURNING id`,
      [
        `Checkout E2E Student ${studentSeq}`,
        `REG-CHK-E2E-${String(studentSeq).padStart(4, '0')}`,
        1000 + studentSeq,
        SEED_SECTION_1_ID,
        SEED_TENANT_ID,
      ],
    );
    return res[0].id;
  }

  async function createFee(studentId: string, totalAmount = 1000): Promise<string> {
    const res = await dataSource.query(
      `INSERT INTO student_fees (id, student_id, academic_year_id, fee_structure_id, period_start, due_date, total_amount, paid_amount, discount_amount, status, created_at, updated_at)
       VALUES (DEFAULT, $1, $2, $3, $4::date, $5::date, $6, 0, 0, 'PENDING', NOW(), NOW())
       RETURNING id`,
      [
        studentId,
        (
          await dataSource.query(`SELECT id FROM academic_years WHERE tenant_id = $1 LIMIT 1`, [
            SEED_TENANT_ID,
          ])
        )[0].id,
        structureId,
        periodStart(1, 2026),
        '2026-01-10',
        totalAmount,
      ],
    );
    return res[0].id;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();

    dataSource = app.get(DataSource);

    await dataSource.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'Checkout E2E Parent', 'ACTIVE', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [PARENT_USER_ID, PARENT_EMAIL, SEED_ADMIN_PASSWORD_HASH],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [PARENT_USER_ID, SEED_TENANT_ID, UserRole.PARENT],
    );

    adminToken = await login(SEED_ADMIN_EMAIL);
    parentToken = await login(PARENT_EMAIL);
  }, 120000);

  afterAll(async () => {
    await app.close();
  });

  /** Rebuilt before every test — see `wallet.e2e-spec.ts` for the same
   * per-test reset pattern (`test/setup.ts`'s global `beforeEach` truncates
   * every transactional table, `fee_structures` included). */
  beforeEach(async () => {
    structureId = await ensureFeeStructure(dataSource);
  });

  it('returns FEE_READ-gated staff a cart for any student in the tenant', async () => {
    const student = await createStudent();
    const bill = await createFee(student, 1000);

    const res = await supertest(app.getHttpServer())
      .get(`${API}/payments/cart`)
      .query({ student_ids: student, amount: 1000 })
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .set('X-Role', UserRole.ADMIN)
      .expect(200);

    expect(res.body.students).toHaveLength(1);
    expect(res.body.students[0].id).toBe(student);
    expect(
      res.body.students[0].bills.map((b: { student_fee_id: string }) => b.student_fee_id),
    ).toEqual([bill]);
    expect(res.body.suggested.allocations).toEqual([{ student_fee_id: bill, amount: 1000 }]);
  });

  it('lets a linked PARENT read the cart for their own child', async () => {
    const student = await createStudent();
    const guardianRows = await dataSource.query(
      `INSERT INTO guardians (id, full_name, relationship, phone, email, tenant_id, user_id, created_at, updated_at)
       VALUES (DEFAULT, 'Checkout E2E Guardian', 'FATHER', '+8801700000098', $1, $2, $3, NOW(), NOW())
       RETURNING id`,
      [PARENT_EMAIL, SEED_TENANT_ID, PARENT_USER_ID],
    );
    await dataSource.query(
      `INSERT INTO student_guardians (student_id, guardian_id) VALUES ($1, $2)`,
      [student, guardianRows[0].id],
    );
    await createFee(student, 500);

    const res = await supertest(app.getHttpServer())
      .get(`${API}/payments/cart`)
      .query({ student_ids: student })
      .set('Authorization', `Bearer ${parentToken}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .set('X-Role', UserRole.PARENT)
      .expect(200);

    expect(res.body.students).toHaveLength(1);
    expect(res.body.students[0].id).toBe(student);
  });

  it('refuses a PARENT who requests a student they are not linked to (403)', async () => {
    const stranger = await createStudent();
    await createFee(stranger);

    await supertest(app.getHttpServer())
      .get(`${API}/payments/cart`)
      .query({ student_ids: stranger })
      .set('Authorization', `Bearer ${parentToken}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .set('X-Role', UserRole.PARENT)
      .expect(403);
  });

  // The original "rejects a role with no FEE_READ" test here was broken:
  // it sent X-Role SUPER_ADMIN with a token whose real membership was
  // ADMIN, so it 401'd at ContextGuard on the role/membership mismatch
  // before PermissionsGuard ever ran — it never actually exercised the
  // permission gate.
  //
  // It cannot be replaced with an equivalent real-membership denial:
  // - every role this route's @Roles() allows (ADMIN/ACCOUNTANT/EXECUTIVE/
  //   TEACHER/PARENT/STUDENT) also holds FEE_READ in ROLE_PERMISSIONS, so
  //   PermissionsGuard's 403 branch is unreachable through this route by
  //   design.
  // - SUPER_ADMIN, the one role @Roles() excludes, bypasses RolesGuard
  //   entirely (`context.guard.ts` RolesGuard: "SUPER_ADMIN bypasses all
  //   role checks") — verified manually while fixing this test: a real
  //   SUPER_ADMIN membership still gets 200, not 403, on this route.
  // So there is no role/permission combination left to test a denial with
  // on this specific endpoint. What server/CLAUDE.md does mandate and this
  // file was missing — missing/invalid X-Tenant-ID — is added below.
  it('returns 401 when the X-Tenant-ID header is missing', async () => {
    const student = await createStudent();

    await supertest(app.getHttpServer())
      .get(`${API}/payments/cart`)
      .query({ student_ids: student })
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Role', UserRole.ADMIN)
      .expect(401);
  });

  it('returns 401 for an invalid/unknown X-Tenant-ID', async () => {
    const student = await createStudent();

    await supertest(app.getHttpServer())
      .get(`${API}/payments/cart`)
      .query({ student_ids: student })
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', '00000000-0000-4000-8000-000000000099')
      .set('X-Role', UserRole.ADMIN)
      .expect(401);
  });

  it('rejects more than MAX_CART_STUDENTS student_ids (400)', async () => {
    const students = await Promise.all(Array.from({ length: 11 }, () => createStudent()));

    await supertest(app.getHttpServer())
      .get(`${API}/payments/cart`)
      .query({ student_ids: students.join(',') })
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .set('X-Role', UserRole.ADMIN)
      .expect(400);
  });
});

describe('POST /payments/checkout (16.4.2)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  let adminToken: string;
  let parentToken: string;
  let accountantToken: string;

  let structureId: string;
  let studentSeq = 0;

  async function login(email: string): Promise<string> {
    const res = await supertest(app.getHttpServer())
      .post(`${API}/auth/login`)
      .send({ email, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    return res.body.access_token;
  }

  async function createStudent(): Promise<string> {
    studentSeq += 1;
    const res = await dataSource.query(
      `INSERT INTO students (id, full_name, registration_number, roll_number, class_section_id, tenant_id, date_of_birth, preferred_communication, enrollment_status, created_at, updated_at)
       VALUES (DEFAULT, $1, $2, $3, $4, $5, '2010-01-01', 'SMS', 'ACTIVE', NOW(), NOW())
       RETURNING id`,
      [
        `Checkout POST E2E Student ${studentSeq}`,
        `REG-CHK-POST-E2E-${String(studentSeq).padStart(4, '0')}`,
        2000 + studentSeq,
        SEED_SECTION_1_ID,
        SEED_TENANT_ID,
      ],
    );
    return res[0].id;
  }

  async function createFee(studentId: string, totalAmount = 1000): Promise<string> {
    const res = await dataSource.query(
      `INSERT INTO student_fees (id, student_id, academic_year_id, fee_structure_id, period_start, due_date, total_amount, paid_amount, discount_amount, status, created_at, updated_at)
       VALUES (DEFAULT, $1, $2, $3, $4::date, $5::date, $6, 0, 0, 'PENDING', NOW(), NOW())
       RETURNING id`,
      [
        studentId,
        (
          await dataSource.query(`SELECT id FROM academic_years WHERE tenant_id = $1 LIMIT 1`, [
            SEED_TENANT_ID,
          ])
        )[0].id,
        structureId,
        periodStart(1, 2026),
        '2026-01-10',
        totalAmount,
      ],
    );
    return res[0].id;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();

    dataSource = app.get(DataSource);

    const PARENT_EMAIL = 'checkout-post-parent@e2e.example';
    const PARENT_USER_ID = '00000000-0000-4000-8000-0000006d0020';
    await dataSource.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'Checkout POST E2E Parent', 'ACTIVE', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [PARENT_USER_ID, PARENT_EMAIL, SEED_ADMIN_PASSWORD_HASH],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [PARENT_USER_ID, SEED_TENANT_ID, UserRole.PARENT],
    );

    const ACCOUNTANT_EMAIL = 'checkout-post-accountant@e2e.example';
    const ACCOUNTANT_USER_ID = '00000000-0000-4000-8000-0000006d0021';
    await dataSource.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'Checkout POST E2E Accountant', 'ACTIVE', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [ACCOUNTANT_USER_ID, ACCOUNTANT_EMAIL, SEED_ADMIN_PASSWORD_HASH],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [ACCOUNTANT_USER_ID, SEED_TENANT_ID, UserRole.ACCOUNTANT],
    );

    adminToken = await login(SEED_ADMIN_EMAIL);
    parentToken = await login(PARENT_EMAIL);
    accountantToken = await login(ACCOUNTANT_EMAIL);
  }, 120000);

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    structureId = await ensureFeeStructure(dataSource);
  });

  it('records a BKASH payment with a transaction reference (happy path)', async () => {
    const student = await createStudent();
    const bill = await createFee(student, 1000);

    const res = await supertest(app.getHttpServer())
      .post(`${API}/payments/checkout`)
      .send({
        idempotency_key: randomUUID(),
        lines: [{ student_fee_id: bill, amount: 1000, one_off_discount: 0 }],
        payment_method: PaymentMethod.BKASH,
        transaction_reference: 'BKASH-REF-001',
      })
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .set('X-Role', UserRole.ADMIN)
      .expect(201);

    expect(res.body.payment.total_amount).toBe('1000.00');
    expect(res.body.invoice_id).toBeTruthy();
  });

  it('allows an ACCOUNTANT to record a checkout (201)', async () => {
    const student = await createStudent();
    const bill = await createFee(student, 750);

    const res = await supertest(app.getHttpServer())
      .post(`${API}/payments/checkout`)
      .send({
        idempotency_key: randomUUID(),
        lines: [{ student_fee_id: bill, amount: 750, one_off_discount: 0 }],
        payment_method: PaymentMethod.CASH,
      })
      .set('Authorization', `Bearer ${accountantToken}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .set('X-Role', UserRole.ACCOUNTANT)
      .expect(201);

    expect(res.body.payment.total_amount).toBe('750.00');
  });

  // RolesGuard (not PermissionsGuard) is what rejects PARENT here — this
  // route's @Roles() is ADMIN/ACCOUNTANT only, so a PARENT never reaches
  // the PAYMENT_RECORD check. RolesGuard throws `UnauthorizedException`
  // (401), matching every other role-gated route in this codebase — see
  // `context.guard.ts`'s `RolesGuard`.
  it('denies a PARENT (not ADMIN/ACCOUNTANT) from recording a checkout (401)', async () => {
    const student = await createStudent();
    const bill = await createFee(student, 500);

    await supertest(app.getHttpServer())
      .post(`${API}/payments/checkout`)
      .send({
        idempotency_key: randomUUID(),
        lines: [{ student_fee_id: bill, amount: 500, one_off_discount: 0 }],
        payment_method: PaymentMethod.CASH,
      })
      .set('Authorization', `Bearer ${parentToken}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .set('X-Role', UserRole.PARENT)
      .expect(401);
  });
});
