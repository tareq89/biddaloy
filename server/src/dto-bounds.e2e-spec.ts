import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UserRole } from '@biddaloy/shared';
import { AppModule } from './app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from './validation-pipe';
import { MONEY_MAX } from './common/constants/money';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
  SEED_SECTION_1_ID,
  SEED_CLASS_1_ID,
  SEED_ACADEMIC_YEAR_ID,
} from '@test/constants';

/**
 * [75.14] DTO bounds: a list `limit` above 100 and a money amount above
 * `MONEY_MAX` (or with more than 2 decimals) is a field-level 400, not a 500
 * or a silently rounded amount. Guards run before the validation pipe, so a
 * caller without the permission keeps its 403/401 whatever the body says.
 */
const API = '/api/v1';
process.env.ACCOUNT_ACCESS_ECHO_SECRETS = 'true';

const TEACHER_USER_ID = '00000000-0000-4000-8000-0000007514a1';
const TEACHER_EMAIL = 'dto-bounds-teacher@e2e.example';
const PARENT_USER_ID = '00000000-0000-4000-8000-0000007514a2';
const PARENT_EMAIL = 'dto-bounds-parent@e2e.example';
// Discount rules sit behind a step-up approval; one approver per token so the
// OTP cooldown (per identifier) never collides.
const APPROVERS: [string, string][] = [
  ['00000000-0000-4000-8000-0000007514b1', 'dto-bounds-approver-1@e2e.example'],
  ['00000000-0000-4000-8000-0000007514b2', 'dto-bounds-approver-2@e2e.example'],
];
const OTHER_TENANT_ID = '00000000-0000-4000-8000-0000007514c1';

// Every list route that gained `@Max(100)` in this ticket.
const LIST_ROUTES = [
  '/students',
  '/guardians',
  '/classes',
  '/exams',
  '/fee-structures',
  '/routines/shifts',
  '/routines/rooms',
];

describe('DTO bounds (75.14)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let adminToken: string;
  let teacherToken: string;
  let parentToken: string;
  let studentId: string;
  const createdFeeStructureIds: string[] = [];

  async function login(email: string): Promise<string> {
    const res = await supertest(app.getHttpServer())
      .post(`${API}/auth/login`)
      .send({ email, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    return res.body.access_token;
  }

  const as = (method: 'get' | 'post', path: string, token: string) =>
    supertest(app.getHttpServer())
      [method](`${API}${path}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', SEED_TENANT_ID);

  async function issueApprovalToken(identifier: string): Promise<string> {
    const requestRes = await as('post', '/auth/step-up/otp/request', adminToken)
      .send({ identifier })
      .expect(202);
    const verifyRes = await as('post', '/auth/step-up', adminToken)
      .send({
        identifier,
        method: 'OTP',
        otp: requestRes.body.debug?.otp,
        scope: 'discount_rules.manage',
      })
      .expect(200);
    return verifyRes.body.approval_token;
  }

  const feeStructure = (amount: number) => ({
    fee_type: 'MONTHLY_TUITION',
    name: 'DTO bounds fee',
    amount,
    class_id: SEED_CLASS_1_ID,
    academic_year_id: SEED_ACADEMIC_YEAR_ID,
  });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    dataSource = app.get(DataSource);

    const users: [string, string, UserRole][] = [
      [TEACHER_USER_ID, TEACHER_EMAIL, UserRole.TEACHER],
      [PARENT_USER_ID, PARENT_EMAIL, UserRole.PARENT],
      ...APPROVERS.map(([id, email]) => [id, email, UserRole.ADMIN] as [string, string, UserRole]),
    ];
    for (const [id, email, role] of users) {
      await dataSource.query(
        `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
         VALUES ($1, $2, $3, 'DTO Bounds E2E', 'ACTIVE', NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [id, email, SEED_ADMIN_PASSWORD_HASH],
      );
      await dataSource.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [id, SEED_TENANT_ID, role],
      );
    }
    // A student for the discount-rule bodies. Never read or changed by the tests.
    const [row] = await dataSource.query(
      `INSERT INTO students (id, full_name, registration_number, roll_number, class_section_id, tenant_id, date_of_birth, preferred_communication, enrollment_status, created_at, updated_at)
       VALUES (DEFAULT, 'DTO Bounds Student', 'REG-DTO-BOUNDS-1', 7514, $1, $2, '2010-01-01', 'SMS', 'ACTIVE', NOW(), NOW())
       RETURNING id`,
      [SEED_SECTION_1_ID, SEED_TENANT_ID],
    );
    studentId = row.id;

    adminToken = await login(SEED_ADMIN_EMAIL);
    teacherToken = await login(TEACHER_EMAIL);
    parentToken = await login(PARENT_EMAIL);
  }, 120000);

  afterAll(async () => {
    for (const id of createdFeeStructureIds) {
      await dataSource.query(`DELETE FROM fee_structures WHERE id = $1`, [id]);
    }
    await dataSource.query(`DELETE FROM students WHERE id = $1`, [studentId]);
    await app.close();
  });

  describe('list limit', () => {
    // The repro for the ticket: this used to return 200 with every row.
    it('GET /students?limit=100000 is 400', async () => {
      await as('get', '/students?limit=100000', adminToken).expect(400);
    });

    it.each(LIST_ROUTES)('GET %s?limit=101 is 400', async (route) => {
      await as('get', `${route}?limit=101`, adminToken).expect(400);
    });

    it.each(LIST_ROUTES)('GET %s?limit=100 is 200 (allowed boundary)', async (route) => {
      await as('get', `${route}?limit=100`, adminToken).expect(200);
    });

    // Denied: guards run before the pipe, so the 403 is unchanged.
    it('a PARENT on /students?limit=101 keeps the 403', async () => {
      await as('get', '/students?limit=101', parentToken).expect(403);
    });

    // Tenant isolation: the pipe does not open anything. A tenant the caller
    // has no membership in is still refused at the guard, not turned into a 400.
    it('a tenant the caller does not belong to is still refused (not 400)', async () => {
      const res = await supertest(app.getHttpServer())
        .get(`${API}/students?limit=101`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', OTHER_TENANT_ID);
      expect([401, 403]).toContain(res.status);
    });
  });

  describe('money fields', () => {
    it('POST /fee-structures with amount one over MONEY_MAX is 400 with a field error', async () => {
      const res = await as('post', '/fee-structures', adminToken)
        .send(feeStructure(100000000))
        .expect(400);
      expect(JSON.stringify(res.body)).toContain('amount');
    });

    it('POST /fee-structures with amount 10.005 (3 decimals) is 400', async () => {
      await as('post', '/fee-structures', adminToken).send(feeStructure(10.005)).expect(400);
    });

    it('POST /fee-structures with amount MONEY_MAX is 201 (allowed boundary)', async () => {
      expect(MONEY_MAX).toBe(99999999.99);
      const res = await as('post', '/fee-structures', adminToken)
        .send(feeStructure(MONEY_MAX))
        .expect(201);
      createdFeeStructureIds.push(res.body.id);
    });

    it('a TEACHER (no FEE_STRUCTURE_CREATE) posting an oversized amount keeps the 403', async () => {
      await as('post', '/fee-structures', teacherToken).send(feeStructure(100000000)).expect(403);
    });

    it('POST /discount-rules FLAT value 10.123 is 400', async () => {
      const approval = await issueApprovalToken(APPROVERS[0][1]);
      await as('post', '/discount-rules', adminToken)
        .set('X-Approval-Token', approval)
        .send({ student_id: studentId, kind: 'FLAT', value: 10.123, reason: 'bounds' })
        .expect(400);
    });

    it('POST /discount-rules PERCENT value 101 is still 400', async () => {
      const approval = await issueApprovalToken(APPROVERS[1][1]);
      await as('post', '/discount-rules', adminToken)
        .set('X-Approval-Token', approval)
        .send({ student_id: studentId, kind: 'PERCENT', value: 101, reason: 'bounds' })
        .expect(400);
    });

    it('POST /payments/checkout with a line amount of 0.001 is 400', async () => {
      await as('post', '/payments/checkout', adminToken)
        .send({
          idempotency_key: '00000000-0000-4000-8000-0000007514d1',
          payment_method: 'CASH',
          lines: [{ student_fee_id: '00000000-0000-4000-8000-0000007514d2', amount: 0.001 }],
        })
        .expect(400);
    });
  });
});
