import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { UserRole } from '@biddaloy/shared';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
  SEED_SECTION_1_ID,
} from '@test/constants';

/**
 * E2E tests for `POST/PATCH/DELETE /discount-rules` and
 * `GET /students/:id/discount-rules` (#677/16.7.3).
 *
 * Covers what only the controller boundary is responsible for (the
 * resolution math and CRUD are already covered by
 * `discount-rules.service.integration.spec.ts`): the `DISCOUNT_RULE_MANAGE`
 * + approval gate on writes, and family read-access scoping on the GET.
 */
const API = '/api/v1';
process.env.ACCOUNT_ACCESS_ECHO_SECRETS = 'true';

describe('Discount Rules E2E (16.7.3)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let adminToken: string;
  let parentToken: string;
  let studentSeq = 0;

  const PARENT_USER_ID = '00000000-0000-4000-8000-0000006e0010';
  const PARENT_EMAIL = 'discount-rules-parent@e2e.example';

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
        `Discount Student ${studentSeq}`,
        `REG-DISC-E2E-${String(studentSeq).padStart(4, '0')}`,
        1000 + studentSeq,
        SEED_SECTION_1_ID,
        SEED_TENANT_ID,
      ],
    );
    return res[0].id;
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
       VALUES ($1, $2, $3, 'Discount Rules E2E Parent', 'ACTIVE', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [PARENT_USER_ID, PARENT_EMAIL, SEED_ADMIN_PASSWORD_HASH],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [PARENT_USER_ID, SEED_TENANT_ID, UserRole.PARENT],
    );

    adminToken = await login(SEED_ADMIN_EMAIL);
    parentToken = await login(PARENT_EMAIL);
  }, 120000);

  afterAll(async () => {
    await app.close();
  });

  describe('write endpoints — approval gate', () => {
    it('POST /discount-rules without X-Approval-Token is refused', async () => {
      const studentId = await createStudent();
      await supertest(app.getHttpServer())
        .post(`${API}/discount-rules`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .send({ student_id: studentId, kind: 'FLAT', value: 100, reason: 'Test' })
        .expect(403);
    });

    it('POST /discount-rules with a valid approval token creates the rule, then GET returns it', async () => {
      const studentId = await createStudent();
      const approvalToken = await issueApprovalToken('discount_rules.manage', SEED_ADMIN_EMAIL);

      const createRes = await supertest(app.getHttpServer())
        .post(`${API}/discount-rules`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .set('X-Approval-Token', approvalToken)
        .send({ student_id: studentId, kind: 'FLAT', value: 150, reason: 'Sibling discount' })
        .expect(201);
      expect(createRes.body.id).toBeDefined();

      const listRes = await supertest(app.getHttpServer())
        .get(`${API}/students/${studentId}/discount-rules`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .expect(200);
      expect(listRes.body).toHaveLength(1);
      expect(listRes.body[0].value).toBe(150);
    });

    it('a spent approval token cannot be reused for a second write', async () => {
      const studentId = await createStudent();
      const approvalToken = await issueApprovalToken('discount_rules.manage', SEED_ADMIN_EMAIL);

      await supertest(app.getHttpServer())
        .post(`${API}/discount-rules`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .set('X-Approval-Token', approvalToken)
        .send({ student_id: studentId, kind: 'FLAT', value: 10, reason: 'First' })
        .expect(201);

      await supertest(app.getHttpServer())
        .post(`${API}/discount-rules`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .set('X-Approval-Token', approvalToken)
        .send({ student_id: studentId, kind: 'FLAT', value: 20, reason: 'Second, reusing token' })
        .expect(403);
    });
  });

  describe('GET /students/:id/discount-rules — family read access', () => {
    it('refuses a PARENT who is not linked to the student', async () => {
      const studentId = await createStudent();
      await supertest(app.getHttpServer())
        .get(`${API}/students/${studentId}/discount-rules`)
        .set('Authorization', `Bearer ${parentToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .expect(403);
    });

    it('admits a linked PARENT for their own child', async () => {
      const studentId = await createStudent();
      const guardianRes = await dataSource.query(
        `INSERT INTO guardians (id, full_name, relationship, phone, email, preferred_communication, is_primary_contact, tenant_id, user_id, created_at, updated_at)
         VALUES (DEFAULT, 'Discount E2E Guardian', 'FATHER', '01700000000', $1, 'SMS', true, $2, $3, NOW(), NOW())
         RETURNING id`,
        [PARENT_EMAIL, SEED_TENANT_ID, PARENT_USER_ID],
      );
      await dataSource.query(
        `INSERT INTO student_guardians (student_id, guardian_id) VALUES ($1, $2)`,
        [studentId, guardianRes[0].id],
      );

      await supertest(app.getHttpServer())
        .get(`${API}/students/${studentId}/discount-rules`)
        .set('Authorization', `Bearer ${parentToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .expect(200);
    });
  });
});
