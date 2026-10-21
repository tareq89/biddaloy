import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { PaymentMethod, UserRole } from '@biddaloy/shared';
import { randomUUID } from 'crypto';
import { ensureFeeStructure, periodStart } from '@test/helpers/fee-fixture.helper';
import {
  SEED_TENANT_ID,
  SEED_SECTION_1_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
  SEED_ACADEMIC_YEAR_ID,
} from '@test/constants';

/**
 * E2E coverage for `GET /reports/collections` and
 * `GET /reports/collections.csv` (16.6.2): permission gate (TEACHER
 * refused, ADMIN allowed) and the CSV export's header row.
 */

const API = '/api/v1';
const TEACHER_USER_ID = '00000000-0000-4000-8000-0000067c0001';
const TEACHER_EMAIL = 'collections-report-teacher@e2e.example';
// Approver identity for the step-up OTP (its own, so the 60s resend cooldown
// on SEED_ADMIN_EMAIL never collides with another spec).
const APPROVER_USER_ID = '00000000-0000-4000-8000-0000067c0002';
const APPROVER_EMAIL = 'collections-report-approver@e2e.example';
const OTHER_TENANT_ID = '00000000-0000-4000-8000-0000067c0003';
const OTHER_ADMIN_USER_ID = '00000000-0000-4000-8000-0000067c0004';
const OTHER_ADMIN_EMAIL = 'collections-report-other-admin@e2e.example';

describe('GET /reports/collections (16.6.2)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let adminToken: string;
  let teacherToken: string;
  let otherAdminToken: string;

  async function login(email: string): Promise<string> {
    const res = await supertest(app.getHttpServer())
      .post(`${API}/auth/login`)
      .send({ email, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    return res.body.access_token;
  }

  beforeAll(async () => {
    // Step-up echoes the OTP only with this flag (see server/CLAUDE.md).
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
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'Collections Report Teacher', 'ACTIVE', NOW(), NOW())
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
       VALUES ($1, $2, $3, 'Collections Report Approver', 'ACTIVE', NOW(), NOW()),
              ($4, $5, $3, 'Collections Report Other Admin', 'ACTIVE', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [
        APPROVER_USER_ID,
        APPROVER_EMAIL,
        SEED_ADMIN_PASSWORD_HASH,
        OTHER_ADMIN_USER_ID,
        OTHER_ADMIN_EMAIL,
      ],
    );
    await dataSource.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, 'Collections Report Other School', 'collections-report-other', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [OTHER_TENANT_ID],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW()), ($4, $5, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [APPROVER_USER_ID, SEED_TENANT_ID, UserRole.ADMIN, OTHER_ADMIN_USER_ID, OTHER_TENANT_ID],
    );

    adminToken = await login(SEED_ADMIN_EMAIL);
    teacherToken = await login(TEACHER_EMAIL);
    otherAdminToken = await login(OTHER_ADMIN_EMAIL);
  }, 120000);

  afterAll(async () => {
    await app.close();
  });

  it('refuses TEACHER (lacks REPORT_COLLECTIONS_READ)', async () => {
    // A valid token whose role lacks the permission is 403 (forbidden).
    await supertest(app.getHttpServer())
      .get(`${API}/reports/collections?from=2026-01-01&to=2026-01-31`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .expect(403);
  });

  it('allows ADMIN and returns the report shape', async () => {
    const res = await supertest(app.getHttpServer())
      .get(`${API}/reports/collections?from=2026-01-01&to=2026-01-31`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .expect(200);

    expect(res.body).toHaveProperty('range');
    expect(res.body).toHaveProperty('totals');
    expect(res.body).toHaveProperty('by_method');
    expect(res.body).toHaveProperty('by_collector');
    expect(res.body).toHaveProperty('by_fee_type');
    expect(res.body).toHaveProperty('by_day');
  });

  it('[2626] reports wallet payouts in totals.wallet_paid_out and by_collector[].paid_out', async () => {
    const [{ id: studentId }] = await dataSource.query(
      `INSERT INTO students (full_name, registration_number, roll_number, class_section_id, date_of_birth, preferred_communication, enrollment_status, tenant_id, created_at, updated_at)
       VALUES ('Payout E2E Student', 'CR-E2E-PAYOUT', 2, $1, '2010-01-01', 'SMS', 'ACTIVE', $2, NOW(), NOW()) RETURNING id`,
      [SEED_SECTION_1_ID, SEED_TENANT_ID],
    );
    const [{ id: walletId }] = await dataSource.query(
      `INSERT INTO student_wallets (tenant_id, student_id, balance) VALUES ($1, $2, 0) RETURNING id`,
      [SEED_TENANT_ID, studentId],
    );
    await dataSource.query(
      `INSERT INTO wallet_transactions (tenant_id, wallet_id, amount, kind, created_at)
       VALUES ($1, $2, -250, 'DEBIT_PAYOUT', '2001-05-10T05:00:00Z')`,
      [SEED_TENANT_ID, walletId],
    );
    try {
      const res = await supertest(app.getHttpServer())
        .get(`${API}/reports/collections?from=2001-05-10&to=2001-05-10`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .expect(200);
      expect(res.body.totals.wallet_paid_out).toBe(250);
      expect(res.body.totals.net).toBe(0);
      expect(res.body.by_collector[0]).toHaveProperty('paid_out', 250);
    } finally {
      // wallet_transactions is append-only: the ledger row (and its wallet and
      // student) stay; the 2001 date keeps them out of every other test's range.
    }
  });

  it('a reversed payment nets to 0 over its two days (rows seeded as the reversal service writes them)', async () => {
    // The real approval-token reversal flow is covered in checkout.controller.e2e-spec.ts;
    // here we only need the two rows it leaves behind (original REFUNDED + reversal row).
    const [{ id: studentId }] = await dataSource.query(
      `INSERT INTO students (full_name, registration_number, roll_number, class_section_id, date_of_birth, preferred_communication, enrollment_status, tenant_id, created_at, updated_at)
       VALUES ('Collections E2E Student', 'CR-E2E-1', 1, $1, '2010-01-01', 'SMS', 'ACTIVE', $2, NOW(), NOW()) RETURNING id`,
      [SEED_SECTION_1_ID, SEED_TENANT_ID],
    );
    const [{ id: origId }] = await dataSource.query(
      `INSERT INTO payments (student_id, total_amount, payment_method, payment_status, payment_date, tenant_id, created_at, updated_at)
       VALUES ($1, 1000, 'CASH', 'REFUNDED', '2001-03-15T05:00:00Z', $2, NOW(), NOW()) RETURNING id`,
      [studentId, SEED_TENANT_ID],
    );
    const [{ id: revId }] = await dataSource.query(
      `INSERT INTO payments (student_id, total_amount, payment_method, payment_status, payment_date, tenant_id, reversal_of_payment_id, created_at, updated_at)
       VALUES ($1, 1000, 'CASH', 'REFUNDED', '2001-03-16T05:00:00Z', $2, $3, NOW(), NOW()) RETURNING id`,
      [studentId, SEED_TENANT_ID, origId],
    );
    await dataSource.query(`UPDATE payments SET reversed_by_payment_id = $1 WHERE id = $2`, [
      revId,
      origId,
    ]);
    try {
      const res = await supertest(app.getHttpServer())
        .get(`${API}/reports/collections?from=2001-03-01&to=2001-03-31`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .expect(200);
      expect(res.body.totals).toMatchObject({ collected: 1000, reversed: 1000, net: 0 });
    } finally {
      await dataSource.query(`UPDATE payments SET reversed_by_payment_id = NULL WHERE id = $1`, [
        origId,
      ]);
      await dataSource.query(`DELETE FROM payments WHERE id IN ($1, $2)`, [revId, origId]);
      await dataSource.query(`DELETE FROM students WHERE id = $1`, [studentId]);
    }
  });

  // #2227 MON-01 through the real reversal route: checkout, then
  // POST /payments/:id/reverse with a step-up approval token.
  it('a payment reversed via POST /payments/:id/reverse nets to 0; another school sees none of it', async () => {
    const http = () => supertest(app.getHttpServer());
    const [{ id: studentId }] = await dataSource.query(
      `INSERT INTO students (full_name, registration_number, roll_number, class_section_id, date_of_birth, preferred_communication, enrollment_status, tenant_id, created_at, updated_at)
       VALUES ('Collections Reverse Student', 'CR-E2E-REV', 2, $1, '2010-01-01', 'SMS', 'ACTIVE', $2, NOW(), NOW()) RETURNING id`,
      [SEED_SECTION_1_ID, SEED_TENANT_ID],
    );
    const structureId = await ensureFeeStructure(dataSource);
    const [{ id: feeId }] = await dataSource.query(
      `INSERT INTO student_fees (student_id, academic_year_id, fee_structure_id, period_start, total_amount, paid_amount, discount_amount, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4::date, 700, 0, 0, 'PENDING', NOW(), NOW()) RETURNING id`,
      [studentId, SEED_ACADEMIC_YEAR_ID, structureId, periodStart(1, 2026)],
    );
    const checkout = await http()
      .post(`${API}/payments/checkout`)
      .send({
        idempotency_key: randomUUID(),
        lines: [{ student_fee_id: feeId, amount: 700, one_off_discount: 0 }],
        payment_method: PaymentMethod.CASH,
      })
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .set('X-Role', UserRole.ADMIN)
      .expect(201);
    const paymentId = checkout.body.payment.id as string;

    const otp = await http()
      .post(`${API}/auth/step-up/otp/request`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .send({ identifier: APPROVER_EMAIL, scope: 'payments.reverse' })
      .expect(202);
    const stepUp = await http()
      .post(`${API}/auth/step-up`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .send({
        identifier: APPROVER_EMAIL,
        method: 'OTP',
        otp: otp.body.debug?.otp,
        scope: 'payments.reverse',
      })
      .expect(200);
    await http()
      .post(`${API}/payments/${paymentId}/reverse`)
      .send({ reason: 'Collections report e2e' })
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .set('X-Role', UserRole.ADMIN)
      .set('X-Approval-Token', stepUp.body.approval_token)
      .expect(200);

    // Payment and reversal both land today; a window around it covers the
    // Dhaka/UTC day boundary.
    const day = (offset: number) =>
      new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
    const range = `from=${day(-2)}&to=${day(2)}`;
    const mine = await http()
      .get(`${API}/reports/collections?${range}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .expect(200);
    expect(mine.body.totals).toMatchObject({ collected: 700, reversed: 700, net: 0 });

    // Tenant isolation: another school's admin sees none of these rows.
    const theirs = await http()
      .get(`${API}/reports/collections?${range}`)
      .set('Authorization', `Bearer ${otherAdminToken}`)
      .set('X-Tenant-ID', OTHER_TENANT_ID)
      .expect(200);
    expect(theirs.body.totals).toMatchObject({ collected: 0, reversed: 0, net: 0 });
  });

  it('refuses TEACHER on the CSV export too', async () => {
    await supertest(app.getHttpServer())
      .get(`${API}/reports/collections.csv?from=2026-01-01&to=2026-01-31`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .expect(403);
  });

  it('CSV export has a header row and UTF-8 BOM', async () => {
    const res = await supertest(app.getHttpServer())
      .get(`${API}/reports/collections.csv?from=2026-01-01&to=2026-01-31`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .expect(200);

    expect(res.headers['content-type']).toContain('text/csv');
    const body: Buffer = res.body instanceof Buffer ? res.body : Buffer.from(res.text, 'utf-8');
    // UTF-8 BOM: EF BB BF
    expect(body[0]).toBe(0xef);
    expect(body[1]).toBe(0xbb);
    expect(body[2]).toBe(0xbf);
    const text = body.slice(3).toString('utf-8');
    const firstLine = text.split('\r\n')[0];
    expect(firstLine).toBe(
      '"Date","Invoice No","Student","Method","Reference","Collector","Amount","Discount","Reversal"',
    );
  });

  it('rejects a full ISO timestamp in `from`/`to` with 400, not a 500', async () => {
    await supertest(app.getHttpServer())
      .get(`${API}/reports/collections?from=2026-03-01T00:00:00Z&to=2026-03-31`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .expect(400);
  });
});
