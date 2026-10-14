import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../../validation-pipe';
import { UserRole, FineTrigger } from '@biddaloy/shared';
import {
  SEED_TENANT_ID,
  SEED_ACADEMIC_YEAR_ID,
  SEED_SECTION_1_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
} from '@test/constants';

/**
 * E2E tests for `POST/PATCH /fees/fine-rules`, `POST /fees/fines/generate*`,
 * `POST /fees/fines`, `POST /fees/fines/:id/waive` and `GET /fees/fines`
 * (38.2.5) — the HTTP boundary these three controllers add once they're
 * wired into `fees.module.ts`. Rule math, sweep computation and bill math
 * are already covered by `fine-rules.service.integration.spec.ts`,
 * `fine-sweep.service.integration.spec.ts` and
 * `fines.service.integration.spec.ts` — this only proves the routes exist,
 * are behind the right `@RequirePermissions()`/`@Roles()`, and the
 * step-up gate on waive.
 */
const API = '/api/v1';
process.env.ACCOUNT_ACCESS_ECHO_SECRETS = 'true';

// Same per-file-dedicated-identifier fix as `discount-rules.controller.e2e-spec.ts`
// — OtpService's per-identifier cooldown/rate-limit is shared across every
// e2e spec file in the same CI worker.
const APPROVER_IDENTITIES: [string, string][] = [
  ['00000000-0000-4000-8000-0000007a0031', 'fines-approver-1@e2e.example'],
];

describe('Fines E2E (38.2.5)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let adminToken: string;
  let executiveToken: string;
  let accountantToken: string;
  let parentToken: string;
  let structureSeq = 0;
  let studentSeq = 0;

  const EXECUTIVE_USER_ID = '00000000-0000-4000-8000-0000007a0010';
  const EXECUTIVE_EMAIL = 'fines-executive@e2e.example';
  const ACCOUNTANT_USER_ID = '00000000-0000-4000-8000-0000007a0011';
  const ACCOUNTANT_EMAIL = 'fines-accountant@e2e.example';
  const PARENT_USER_ID = '00000000-0000-4000-8000-0000007a0012';
  const PARENT_EMAIL = 'fines-parent@e2e.example';

  async function login(email: string): Promise<string> {
    const res = await supertest(app.getHttpServer())
      .post(`${API}/auth/login`)
      .send({ email, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    return res.body.access_token;
  }

  async function issueApprovalToken(scope: string, identifier: string): Promise<string> {
    const requestRes = await supertest(app.getHttpServer())
      .post(`${API}/auth/step-up/otp/request`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .send({ identifier })
      .expect(202);
    const otp = requestRes.body.debug?.otp;

    const verifyRes = await supertest(app.getHttpServer())
      .post(`${API}/auth/step-up`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .send({ identifier, method: 'OTP', otp, scope })
      .expect(200);
    return verifyRes.body.approval_token;
  }

  async function createFineStructure(amount = 50): Promise<string> {
    structureSeq += 1;
    const res = await dataSource.query(
      `INSERT INTO fee_structures (id, tenant_id, academic_year_id, name, fee_type, amount, created_at, updated_at)
       VALUES (DEFAULT, $1, $2, $3, 'FINE', $4, NOW(), NOW())
       RETURNING id`,
      [SEED_TENANT_ID, SEED_ACADEMIC_YEAR_ID, `Fines E2E Structure ${structureSeq}`, amount],
    );
    return res[0].id;
  }

  async function createStudent(): Promise<string> {
    studentSeq += 1;
    const res = await dataSource.query(
      `INSERT INTO students (id, full_name, registration_number, roll_number, class_section_id, tenant_id, date_of_birth, preferred_communication, enrollment_status, created_at, updated_at)
       VALUES (DEFAULT, $1, $2, $3, $4, $5, '2010-01-01', 'SMS', 'ACTIVE', NOW(), NOW())
       RETURNING id`,
      [
        `Fines Student ${studentSeq}`,
        `REG-FINES-E2E-${String(studentSeq).padStart(4, '0')}`,
        2000 + studentSeq,
        SEED_SECTION_1_ID,
        SEED_TENANT_ID,
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

    for (const [id, email, role] of [
      [EXECUTIVE_USER_ID, EXECUTIVE_EMAIL, UserRole.EXECUTIVE],
      [ACCOUNTANT_USER_ID, ACCOUNTANT_EMAIL, UserRole.ACCOUNTANT],
      [PARENT_USER_ID, PARENT_EMAIL, UserRole.PARENT],
    ] as const) {
      await dataSource.query(
        `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
         VALUES ($1, $2, $3, 'Fines E2E User', 'ACTIVE', NOW(), NOW())
         ON CONFLICT DO NOTHING`,
        [id, email, SEED_ADMIN_PASSWORD_HASH],
      );
      await dataSource.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW())
         ON CONFLICT DO NOTHING`,
        [id, SEED_TENANT_ID, role],
      );
    }
    for (const [id, email] of APPROVER_IDENTITIES) {
      await dataSource.query(
        `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
         VALUES ($1, $2, $3, 'Fines E2E Approver', 'ACTIVE', NOW(), NOW())
         ON CONFLICT DO NOTHING`,
        [id, email, SEED_ADMIN_PASSWORD_HASH],
      );
      await dataSource.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [id, SEED_TENANT_ID, UserRole.ADMIN],
      );
    }

    adminToken = await login(SEED_ADMIN_EMAIL);
    executiveToken = await login(EXECUTIVE_EMAIL);
    accountantToken = await login(ACCOUNTANT_EMAIL);
    parentToken = await login(PARENT_EMAIL);
  }, 120000);

  afterAll(async () => {
    await app.close();
  });

  describe('fine rules CRUD', () => {
    it('ADMIN creates a rule, then GET /fees/fine-rules lists it', async () => {
      const structureId = await createFineStructure();
      const createRes = await supertest(app.getHttpServer())
        .post(`${API}/fees/fine-rules`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .send({
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
          trigger: FineTrigger.ATTENDANCE_ABSENT,
          fee_structure_id: structureId,
          class_id: null,
          free_per_period: 0,
          conditions: {},
        })
        .expect(201);
      expect(createRes.body.id).toBeDefined();

      const listRes = await supertest(app.getHttpServer())
        .get(`${API}/fees/fine-rules?academic_year_id=${SEED_ACADEMIC_YEAR_ID}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .expect(200);
      expect(listRes.body.some((r: { id: string }) => r.id === createRes.body.id)).toBe(true);
    });

    it('ACCOUNTANT is allowed to create a rule', async () => {
      const structureId = await createFineStructure();
      await supertest(app.getHttpServer())
        .post(`${API}/fees/fine-rules`)
        .set('Authorization', `Bearer ${accountantToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .send({
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
          trigger: FineTrigger.ATTENDANCE_ABSENT,
          fee_structure_id: structureId,
          class_id: null,
          free_per_period: 0,
          conditions: {},
        })
        .expect(201);
    });

    it('EXECUTIVE is refused on create (PermissionsGuard 403)', async () => {
      const structureId = await createFineStructure();
      await supertest(app.getHttpServer())
        .post(`${API}/fees/fine-rules`)
        .set('Authorization', `Bearer ${executiveToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .send({
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
          trigger: FineTrigger.ATTENDANCE_ABSENT,
          fee_structure_id: structureId,
          class_id: null,
          free_per_period: 0,
          conditions: {},
        })
        .expect(403);
    });
  });

  describe('attendance-fine sweep', () => {
    it('preview then generate for a month with no due fines returns/creates nothing (no error)', async () => {
      const previewRes = await supertest(app.getHttpServer())
        .post(`${API}/fees/fines/generate/preview`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .send({ month: '2026-02' })
        .expect(201);
      expect(previewRes.body.students).toEqual([]);

      const generateRes = await supertest(app.getHttpServer())
        .post(`${API}/fees/fines/generate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .send({ month: '2026-02' })
        .expect(201);
      expect(generateRes.body.generated_count).toBe(0);
    });
  });

  describe('generate: manual run uses the Dhaka day', () => {
    afterEach(() => vi.useRealTimers());

    it('00:30 Dhaka on 5 Aug: fine is due 12 Aug, not 11 Aug', async () => {
      // A student with 2 absences in the seed year's first month + an active rule.
      const [year] = await dataSource.query(
        `SELECT to_char(start_date, 'YYYY-MM') AS month, to_char(start_date, 'YYYY-MM-DD') AS d1,
                to_char(start_date + 1, 'YYYY-MM-DD') AS d2
           FROM academic_years WHERE id = $1`,
        [SEED_ACADEMIC_YEAR_ID],
      );
      const structureId = await createFineStructure(30);
      const studentId = await createStudent();
      await dataSource.query(
        `INSERT INTO fine_rules (id, tenant_id, academic_year_id, trigger, fee_structure_id, class_id, free_per_period, conditions, is_active, created_at, updated_at)
         VALUES (DEFAULT, $1, $2, 'ATTENDANCE_ABSENT', $3, NULL, 0, '{}', true, NOW(), NOW())`,
        [SEED_TENANT_ID, SEED_ACADEMIC_YEAR_ID, structureId],
      );
      for (const date of [year.d1, year.d2]) {
        const [session] = await dataSource.query(
          `INSERT INTO attendance_sessions (id, tenant_id, section_id, date, period_no, state, created_at, updated_at)
           VALUES (DEFAULT, $1, $2, $3, NULL, 'FINALIZED', NOW(), NOW()) RETURNING id`,
          [SEED_TENANT_ID, SEED_SECTION_1_ID, date],
        );
        await dataSource.query(
          `INSERT INTO attendance_records (id, tenant_id, session_id, student_id, date, status)
           VALUES (DEFAULT, $1, $2, $3, $4, 'ABSENT')`,
          [SEED_TENANT_ID, session.id, studentId, date],
        );
      }

      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-08-04T18:30:00Z'));
      const token = await login(SEED_ADMIN_EMAIL);
      await supertest(app.getHttpServer())
        .post(`${API}/fees/fines/generate`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .send({ month: year.month })
        .expect(201);
      vi.useRealTimers();

      const [bill] = await dataSource.query(
        `SELECT to_char(due_date, 'YYYY-MM-DD') AS due_date FROM student_fees
          WHERE student_id = $1 AND fee_structure_id = $2`,
        [studentId, structureId],
      );
      expect(bill.due_date).toBe('2026-08-12');
    });
  });

  describe('log fine', () => {
    it('ADMIN logs a manual fine, and the bill shows up in GET /fees/fines', async () => {
      const structureId = await createFineStructure(100);
      const studentId = await createStudent();

      const logRes = await supertest(app.getHttpServer())
        .post(`${API}/fees/fines`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .send({
          student_ids: [studentId],
          fee_structure_id: structureId,
          note: 'Broke a window pane',
          incident_date: '2026-09-01',
          notify_families: false,
        })
        .expect(201);
      expect(logRes.body.bill_ids).toHaveLength(1);

      const listRes = await supertest(app.getHttpServer())
        .get(`${API}/fees/fines?student_id=${studentId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .expect(200);
      expect(listRes.body.items.some((f: { id: string }) => f.id === logRes.body.bill_ids[0])).toBe(
        true,
      );
    });
  });

  describe('waive fine — step-up gate', () => {
    it('without X-Approval-Token is refused with 403', async () => {
      const structureId = await createFineStructure(100);
      const studentId = await createStudent();
      const logRes = await supertest(app.getHttpServer())
        .post(`${API}/fees/fines`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .send({
          student_ids: [studentId],
          fee_structure_id: structureId,
          note: 'No approval token test',
          incident_date: '2026-09-01',
          notify_families: false,
        })
        .expect(201);
      const billId = logRes.body.bill_ids[0];

      await supertest(app.getHttpServer())
        .post(`${API}/fees/fines/${billId}/waive`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .send({ reason: 'Waiving without a token' })
        .expect(403);
    });

    it('with a valid approval token waives the bill', async () => {
      const structureId = await createFineStructure(100);
      const studentId = await createStudent();
      const logRes = await supertest(app.getHttpServer())
        .post(`${API}/fees/fines`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .send({
          student_ids: [studentId],
          fee_structure_id: structureId,
          note: 'Waived via valid token',
          incident_date: '2026-09-01',
          notify_families: false,
        })
        .expect(201);
      const billId = logRes.body.bill_ids[0];

      const approvalToken = await issueApprovalToken('fees.discount', APPROVER_IDENTITIES[0][1]);

      const waiveRes = await supertest(app.getHttpServer())
        .post(`${API}/fees/fines/${billId}/waive`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .set('X-Approval-Token', approvalToken)
        .send({ reason: 'Family hardship' })
        .expect(201);
      expect(waiveRes.body.status).toBe('WAIVED');
    });
  });

  describe('POST /fees/bills/:id/waive — any bill (MON-08)', () => {
    const TENANT_B = '00000000-0000-4000-8000-0000007a00b1';

    async function createBill(tenantId: string, feeType: string, total: number): Promise<string> {
      structureSeq += 1;
      const structure = await dataSource.query(
        `INSERT INTO fee_structures (id, tenant_id, academic_year_id, name, fee_type, amount, created_at, updated_at)
         VALUES (DEFAULT, $1, $2, $3, $4, $5, NOW(), NOW()) RETURNING id`,
        [tenantId, SEED_ACADEMIC_YEAR_ID, `Waive Any ${structureSeq}`, feeType, total],
      );
      const studentId = await createStudent();
      const bill = await dataSource.query(
        `INSERT INTO student_fees (id, student_id, academic_year_id, fee_structure_id, period_start, occurrence,
           total_amount, paid_amount, discount_amount, standing_discount_amount, one_off_discount_amount, status, created_at, updated_at)
         VALUES (DEFAULT, $1, $2, $3, '2026-09-01', 1, $4, 0, 0, 0, 0, 'PENDING', NOW(), NOW()) RETURNING id`,
        [studentId, SEED_ACADEMIC_YEAR_ID, structure[0].id, total],
      );
      return bill[0].id;
    }

    it('without X-Approval-Token is refused with 403', async () => {
      const billId = await createBill(SEED_TENANT_ID, 'MONTHLY_TUITION', 1000);
      await supertest(app.getHttpServer())
        .post(`${API}/fees/bills/${billId}/waive`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .send({ reason: 'No token' })
        .expect(403);
    });

    it('with a fees.discount token writes off a tuition bill and returns 200', async () => {
      const billId = await createBill(SEED_TENANT_ID, 'MONTHLY_TUITION', 1000);
      const approvalToken = await issueApprovalToken('fees.discount', APPROVER_IDENTITIES[0][1]);
      const res = await supertest(app.getHttpServer())
        .post(`${API}/fees/bills/${billId}/waive`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .set('X-Approval-Token', approvalToken)
        .send({ reason: 'Hardship month' })
        .expect(200);
      expect(res.body).toMatchObject({ id: billId, amount: 1000, status: 'WAIVED' });
    });

    it('an ACCOUNTANT (no FEE_APPROVE) is refused with 403', async () => {
      const billId = await createBill(SEED_TENANT_ID, 'LATE_FEE', 50);
      const res = await supertest(app.getHttpServer())
        .post(`${API}/fees/bills/${billId}/waive`)
        .set('Authorization', `Bearer ${accountantToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .send({ reason: 'Not allowed' })
        .expect(403);
      // The role is what refuses, not the missing approval token.
      expect(res.body.details?.code).not.toBe('APPROVAL_REQUIRED');
    });

    it("another tenant's bill is 404", async () => {
      await dataSource.query(
        `INSERT INTO schools (id, name, slug, created_at, updated_at)
         VALUES ($1, 'Waive Any Tenant B', 'waive-any-tenant-b', NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [TENANT_B],
      );
      const billId = await createBill(TENANT_B, 'MONTHLY_TUITION', 500);
      const approvalToken = await issueApprovalToken('fees.discount', APPROVER_IDENTITIES[0][1]);
      const res = await supertest(app.getHttpServer())
        .post(`${API}/fees/bills/${billId}/waive`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .set('X-Approval-Token', approvalToken)
        .send({ reason: 'Wrong tenant' })
        .expect(404);
      expect(res.body.message).toBe(`Bill "${billId}" not found`);
    });
  });

  describe('GET /fees/fines — PARENT read access', () => {
    it('a PARENT with no linked students gets an empty page, not a 403', async () => {
      const res = await supertest(app.getHttpServer())
        .get(`${API}/fees/fines`)
        .set('Authorization', `Bearer ${parentToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .expect(200);
      expect(res.body.items).toEqual([]);
    });
  });
});
