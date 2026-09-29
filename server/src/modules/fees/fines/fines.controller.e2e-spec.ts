import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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

    it('EXECUTIVE is refused on create (RolesGuard 401 — `@Roles()` mismatch, not a permission 403)', async () => {
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
        .expect(401);
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
