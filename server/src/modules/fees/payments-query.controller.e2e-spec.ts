import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { PaymentMethod, PaymentAllocationType, UserRole } from '@biddaloy/shared';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
  SEED_SECTION_1_ID,
  SEED_ACADEMIC_YEAR_ID,
} from '@test/constants';
import { ensureFeeStructure, periodStart } from '@test/helpers/fee-fixture.helper';

/**
 * E2E tests for `GET /payments` and `GET /payments/:id` (16.4.3),
 * `PaymentsQueryService`'s HTTP surface.
 *
 * `payments-query.service.integration.spec.ts` already covers the query
 * logic itself (filters, joins, pagination) against the real database. This
 * file covers what only exists at the HTTP layer: the `PAYMENT_READ` gate,
 * missing/invalid `X-Tenant-ID`, tenant isolation, and the family allow-list
 * path through `GET /payments/student/:studentId` (which is where the
 * `fee_name`/`period_start` join fix — F1 — actually surfaces for a family
 * caller).
 */

const API = '/api/v1';

const OTHER_TENANT_ID = '00000000-0000-4000-8000-0000006f0001';
const ACCOUNTANT_EMAIL = 'payments-query-accountant@e2e.example';
const ACCOUNTANT_USER_ID = '00000000-0000-4000-8000-0000006f0002';
const TEACHER_EMAIL = 'payments-query-teacher@e2e.example';
const TEACHER_USER_ID = '00000000-0000-4000-8000-0000006f0003';
const PARENT_EMAIL = 'payments-query-parent@e2e.example';
const PARENT_USER_ID = '00000000-0000-4000-8000-0000006f0004';

describe('GET /payments, GET /payments/:id (16.4.3)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  let adminToken: string;
  let accountantToken: string;
  let teacherToken: string;
  let parentToken: string;

  let structureId: string;
  let otherSectionId: string;
  let studentSeq = 0;

  async function login(email: string): Promise<string> {
    const res = await supertest(app.getHttpServer())
      .post(`${API}/auth/login`)
      .send({ email, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    return res.body.access_token;
  }

  async function createStudent(tenantId = SEED_TENANT_ID): Promise<string> {
    studentSeq += 1;
    const res = await dataSource.query(
      `INSERT INTO students (id, full_name, registration_number, roll_number, class_section_id, tenant_id, date_of_birth, preferred_communication, enrollment_status, created_at, updated_at)
       VALUES (DEFAULT, $1, $2, $3, $4, $5, '2010-01-01', 'SMS', 'ACTIVE', NOW(), NOW())
       RETURNING id`,
      [
        `Payments Query E2E Student ${studentSeq}`,
        `REG-PQ-E2E-${String(studentSeq).padStart(4, '0')}`,
        3000 + studentSeq,
        tenantId === SEED_TENANT_ID ? SEED_SECTION_1_ID : otherSectionId,
        tenantId,
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
        SEED_ACADEMIC_YEAR_ID,
        structureId,
        periodStart(1, 2026),
        '2026-01-10',
        totalAmount,
      ],
    );
    return res[0].id;
  }

  async function createPayment(
    studentId: string,
    tenantId: string,
    overrides: { transaction_reference?: string; payment_date?: string } = {},
  ): Promise<string> {
    const res = await dataSource.query(
      `INSERT INTO payments (id, student_id, total_amount, payment_method, payment_status, transaction_reference, payment_date, tenant_id, created_at, updated_at)
       VALUES (DEFAULT, $1, $2, $3, 'SUCCESS', $4, $5::timestamptz, $6, NOW(), NOW())
       RETURNING id`,
      [
        studentId,
        1000,
        PaymentMethod.CASH,
        overrides.transaction_reference ?? `PQ-TXN-${randomSuffix()}`,
        overrides.payment_date ?? '2026-01-15T10:00:00Z',
        tenantId,
      ],
    );
    return res[0].id;
  }

  async function allocatePayment(paymentId: string, studentFeeId: string): Promise<void> {
    await dataSource.query(
      `INSERT INTO payment_allocations (id, payment_id, student_fee_id, allocated_amount, allocation_type, discount_amount, created_at)
       VALUES (DEFAULT, $1, $2, 1000, $3, 0, NOW())`,
      [paymentId, studentFeeId, PaymentAllocationType.CURRENT],
    );
  }

  let suffixSeq = 0;
  function randomSuffix(): string {
    suffixSeq += 1;
    return String(suffixSeq).padStart(6, '0');
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
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, 'Payments Query Other Tenant', 'payments-query-e2e-other-tenant', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [OTHER_TENANT_ID],
    );
    const otherAcademicYearId = '00000000-0000-4000-8000-0000006f0090';
    const otherClassId = '00000000-0000-4000-8000-0000006f0091';
    await dataSource.query(
      `INSERT INTO academic_years (id, name, start_date, end_date, is_current, tenant_id, created_at, updated_at)
       VALUES ($1, 'Other AY', '2026-01-01', '2026-12-31', false, $2, NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [otherAcademicYearId, OTHER_TENANT_ID],
    );
    await dataSource.query(
      `INSERT INTO classes (id, name, academic_year_id, tenant_id, created_at, updated_at)
       VALUES ($1, 'Other Class', $2, $3, NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [otherClassId, otherAcademicYearId, OTHER_TENANT_ID],
    );
    const otherSectionRows = await dataSource.query(
      `INSERT INTO class_sections (id, class_id, section_name, tenant_id, created_at, updated_at)
       VALUES (DEFAULT, $1, 'Other Section', $2, NOW(), NOW())
       RETURNING id`,
      [otherClassId, OTHER_TENANT_ID],
    );
    otherSectionId = otherSectionRows[0].id;

    await dataSource.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'Payments Query E2E Accountant', 'ACTIVE', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [ACCOUNTANT_USER_ID, ACCOUNTANT_EMAIL, SEED_ADMIN_PASSWORD_HASH],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [ACCOUNTANT_USER_ID, SEED_TENANT_ID, UserRole.ACCOUNTANT],
    );

    // TEACHER is not in `GET /payments`'s @Roles() list — used below for the
    // RolesGuard-denial test (see the comment there for why a genuine
    // PermissionsGuard denial isn't reachable through these two routes).
    await dataSource.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'Payments Query E2E Teacher', 'ACTIVE', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [TEACHER_USER_ID, TEACHER_EMAIL, SEED_ADMIN_PASSWORD_HASH],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [TEACHER_USER_ID, SEED_TENANT_ID, UserRole.TEACHER],
    );

    await dataSource.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'Payments Query E2E Parent', 'ACTIVE', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [PARENT_USER_ID, PARENT_EMAIL, SEED_ADMIN_PASSWORD_HASH],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [PARENT_USER_ID, SEED_TENANT_ID, UserRole.PARENT],
    );

    adminToken = await login(SEED_ADMIN_EMAIL);
    accountantToken = await login(ACCOUNTANT_EMAIL);
    teacherToken = await login(TEACHER_EMAIL);
    parentToken = await login(PARENT_EMAIL);
  }, 120000);

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    structureId = await ensureFeeStructure(dataSource);
  });

  describe('GET /payments', () => {
    it('allows ADMIN and ACCOUNTANT to list payments', async () => {
      const student = await createStudent();
      await createPayment(student, SEED_TENANT_ID);

      await supertest(app.getHttpServer())
        .get(`${API}/payments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .expect(200);

      await supertest(app.getHttpServer())
        .get(`${API}/payments`)
        .set('Authorization', `Bearer ${accountantToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .set('X-Role', UserRole.ACCOUNTANT)
        .expect(200);
    });

    // `GET /payments`/`GET /payments/:id` only allow ADMIN/ACCOUNTANT via
    // `@Roles()`, and both hold PAYMENT_READ in ROLE_PERMISSIONS (see
    // shared/src/enums/permissions.ts) — so, same conclusion as
    // `checkout.controller.e2e-spec.ts`'s documented finding, there is no
    // role/membership that reaches PermissionsGuard through *these two
    // routes* and gets refused there: any role outside @Roles() (e.g.
    // TEACHER, which lacks PAYMENT_READ) is rejected by RolesGuard first
    // (401), never reaching PermissionsGuard's 403 branch. This is the
    // closest verifiable denial these two routes can produce.
    it('returns 401 for a role outside @Roles() (RolesGuard)', async () => {
      await supertest(app.getHttpServer())
        .get(`${API}/payments`)
        .set('Authorization', `Bearer ${teacherToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .set('X-Role', UserRole.TEACHER)
        .expect(401);
    });

    it('returns 401 when X-Tenant-ID is missing', async () => {
      await supertest(app.getHttpServer())
        .get(`${API}/payments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Role', UserRole.ADMIN)
        .expect(401);
    });

    it('returns 401 for an invalid/unknown X-Tenant-ID', async () => {
      await supertest(app.getHttpServer())
        .get(`${API}/payments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', '00000000-0000-4000-8000-000000000099')
        .set('X-Role', UserRole.ADMIN)
        .expect(401);
    });

    it("never returns another tenant's payments", async () => {
      const ownStudent = await createStudent();
      const ownPayment = await createPayment(ownStudent, SEED_TENANT_ID, {
        transaction_reference: 'OWN-TENANT-REF',
      });
      const otherStudent = await createStudent(OTHER_TENANT_ID);
      await createPayment(otherStudent, OTHER_TENANT_ID, {
        transaction_reference: 'OTHER-TENANT-REF',
      });

      const res = await supertest(app.getHttpServer())
        .get(`${API}/payments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .expect(200);

      const ids = res.body.data.map((p: { id: string }) => p.id);
      expect(ids).toContain(ownPayment);
      // No row belonging to the other tenant leaked in.
      const refs = res.body.data.map(
        (p: { transaction_reference: string }) => p.transaction_reference,
      );
      expect(refs).not.toContain('OTHER-TENANT-REF');
    });

    it('applies an inclusive date_to boundary (F2): a same-day payment is not excluded', async () => {
      const student = await createStudent();
      // 23:30 UTC on 2026-02-10 — inside the day but after naive midnight,
      // which a non-inclusive date_to would have excluded (F2).
      const lateInDay = await createPayment(student, SEED_TENANT_ID, {
        payment_date: '2026-02-10T23:30:00Z',
      });

      const res = await supertest(app.getHttpServer())
        .get(`${API}/payments`)
        .query({ date_from: '2026-02-01', date_to: '2026-02-10' })
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .expect(200);

      expect(res.body.data.map((p: { id: string }) => p.id)).toContain(lateInDay);
    });

    it('finds a reversed payment when include_reversed=true is set explicitly (F4)', async () => {
      const student = await createStudent();
      const original = await createPayment(student, SEED_TENANT_ID, {
        transaction_reference: 'REV-ORIGINAL',
      });
      const reversal = await createPayment(student, SEED_TENANT_ID, {
        transaction_reference: 'REV-REVERSAL',
      });
      await dataSource.query(`UPDATE payments SET reversal_of_payment_id = $1 WHERE id = $2`, [
        original,
        reversal,
      ]);
      await dataSource.query(`UPDATE payments SET reversed_by_payment_id = $1 WHERE id = $2`, [
        reversal,
        original,
      ]);

      // Default (include_reversed omitted) excludes the reversed original.
      const defaultRes = await supertest(app.getHttpServer())
        .get(`${API}/payments`)
        .query({ search: 'REV-' })
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .expect(200);
      expect(defaultRes.body.data.map((p: { id: string }) => p.id)).not.toContain(original);

      // Explicitly asking for it finds it.
      const includedRes = await supertest(app.getHttpServer())
        .get(`${API}/payments`)
        .query({ search: 'REV-', include_reversed: 'true' })
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .expect(200);
      const includedIds = includedRes.body.data.map((p: { id: string }) => p.id);
      expect(includedIds).toContain(original);
      expect(includedIds).toContain(reversal);
    });

    it('returns the payment row (with student: null) when its student was soft-deleted, not a crash or omission', async () => {
      const student = await createStudent();
      const payment = await createPayment(student, SEED_TENANT_ID, {
        transaction_reference: 'SOFT-DELETED-STUDENT',
      });
      await dataSource.query(`UPDATE students SET deleted_at = NOW() WHERE id = $1`, [student]);

      const res = await supertest(app.getHttpServer())
        .get(`${API}/payments`)
        .query({ search: 'SOFT-DELETED-STUDENT' })
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .expect(200);

      const row = res.body.data.find((p: { id: string }) => p.id === payment);
      expect(row).toBeTruthy();
      expect(row.student).toBeNull();
    });
  });

  describe('GET /payments/:id', () => {
    it('allows ADMIN and ACCOUNTANT to fetch one payment', async () => {
      const student = await createStudent();
      const payment = await createPayment(student, SEED_TENANT_ID);

      await supertest(app.getHttpServer())
        .get(`${API}/payments/${payment}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .expect(200);

      await supertest(app.getHttpServer())
        .get(`${API}/payments/${payment}`)
        .set('Authorization', `Bearer ${accountantToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .set('X-Role', UserRole.ACCOUNTANT)
        .expect(200);
    });

    it('returns 401 for a role outside @Roles() (RolesGuard)', async () => {
      const student = await createStudent();
      const payment = await createPayment(student, SEED_TENANT_ID);

      await supertest(app.getHttpServer())
        .get(`${API}/payments/${payment}`)
        .set('Authorization', `Bearer ${teacherToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .set('X-Role', UserRole.TEACHER)
        .expect(401);
    });

    it('returns 401 when X-Tenant-ID is missing', async () => {
      const student = await createStudent();
      const payment = await createPayment(student, SEED_TENANT_ID);

      await supertest(app.getHttpServer())
        .get(`${API}/payments/${payment}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Role', UserRole.ADMIN)
        .expect(401);
    });

    it('returns 401 for an invalid/unknown X-Tenant-ID', async () => {
      const student = await createStudent();
      const payment = await createPayment(student, SEED_TENANT_ID);

      await supertest(app.getHttpServer())
        .get(`${API}/payments/${payment}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', '00000000-0000-4000-8000-000000000099')
        .set('X-Role', UserRole.ADMIN)
        .expect(401);
    });

    it("cannot fetch another tenant's payment by id (tenant isolation)", async () => {
      const otherStudent = await createStudent(OTHER_TENANT_ID);
      const otherPayment = await createPayment(otherStudent, OTHER_TENANT_ID);

      await supertest(app.getHttpServer())
        .get(`${API}/payments/${otherPayment}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .expect(404);
    });

    it('returns decimal fields as numbers, not strings (item 6)', async () => {
      const student = await createStudent();
      const bill = await createFee(student, 1000);
      const payment = await createPayment(student, SEED_TENANT_ID);
      await allocatePayment(payment, bill);

      const res = await supertest(app.getHttpServer())
        .get(`${API}/payments/${payment}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .expect(200);

      expect(typeof res.body.total_amount).toBe('number');
      expect(typeof res.body.allocations[0].allocated_amount).toBe('number');
      expect(typeof res.body.allocations[0].discount_amount).toBe('number');
    });
  });

  describe('GET /payments/student/:studentId (family allow-list, F1)', () => {
    it("lets a linked PARENT see only their own child's payments, with fee_name/period_start populated", async () => {
      const child = await createStudent();
      const stranger = await createStudent();
      const bill = await createFee(child, 1000);
      const childPayment = await createPayment(child, SEED_TENANT_ID, {
        transaction_reference: 'FAMILY-CHILD-PAYMENT',
      });
      await allocatePayment(childPayment, bill);
      await createPayment(stranger, SEED_TENANT_ID, {
        transaction_reference: 'FAMILY-STRANGER-PAYMENT',
      });

      const guardianRows = await dataSource.query(
        `INSERT INTO guardians (id, full_name, relationship, phone, email, tenant_id, user_id, created_at, updated_at)
         VALUES (DEFAULT, 'Payments Query E2E Guardian', 'FATHER', '+8801700000099', $1, $2, $3, NOW(), NOW())
         RETURNING id`,
        [PARENT_EMAIL, SEED_TENANT_ID, PARENT_USER_ID],
      );
      await dataSource.query(
        `INSERT INTO student_guardians (student_id, guardian_id) VALUES ($1, $2)`,
        [child, guardianRows[0].id],
      );

      const res = await supertest(app.getHttpServer())
        .get(`${API}/payments/student/${child}`)
        .set('Authorization', `Bearer ${parentToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .set('X-Role', UserRole.PARENT)
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0].id).toBe(childPayment);
      // F1: the family allow-list mapper now joins student_fee/fee_structure,
      // so these are populated rather than always null.
      expect(res.body[0].allocations[0].fee_name).toBe('Test Tuition');
      expect(res.body[0].allocations[0].period_start).toBeTruthy();

      // The stranger's payment is refused outright (family-access check
      // runs before the query, per FeeController.findPaymentsByStudent).
      // `FamilyAccessService.assertLinked` throws `UnauthorizedException`
      // for an unlinked student, so this is a 401, not a 403.
      await supertest(app.getHttpServer())
        .get(`${API}/payments/student/${stranger}`)
        .set('Authorization', `Bearer ${parentToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .set('X-Role', UserRole.PARENT)
        .expect(401);
    });
  });
});
