import { randomUUID } from 'crypto';
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
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

  async function login(email: string): Promise<string> {
    const res = await supertest(app.getHttpServer())
      .post(`${API}/auth/login`)
      .send({ email, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    return res.body.access_token;
  }

  const as = (method: 'get' | 'post' | 'patch', path: string, token: string) =>
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

  /** The 400 must name the field under test, so an unrelated 400 (a missing
   * fixture, another field) can't make a case pass. */
  const expectFieldError = (res: supertest.Response, field: RegExp) => {
    expect(res.status).toBe(400);
    expect(res.body.message).toEqual(expect.arrayContaining([expect.stringMatching(field)]));
  };

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
    adminToken = await login(SEED_ADMIN_EMAIL);
    teacherToken = await login(TEACHER_EMAIL);
    parentToken = await login(PARENT_EMAIL);
  }, 120000);

  // `test/setup.ts` wipes students and fee structures before every test, so
  // nothing created here needs cleaning up.
  afterAll(async () => {
    await app.close();
  });

  describe('real dates', () => {
    // Path ids are random: validation runs before any lookup.
    const id = randomUUID();
    it.each([
      [`/attendance/students/${id}/days?month=2026-13`, /^month /],
      [`/attendance/students/${id}/summary?month=2026-13`, /^month /],
      [`/attendance/sections/${id}/summary?from=2026-02-30&to=2026-03-01`, /^from /],
      [`/attendance/sections/${id}/register?date=2026-02-30`, /^date /],
      [`/attendance/sections/${id}/register-matrix?month=2026-13`, /^month /],
      ['/invoices?from_date=2026-02-30', /^from_date /],
      ['/attendance/flags/low?from=2026-02-30&to=2026-03-01', /^from /],
    ])('GET %s is 400 naming the field', async (path, field) => {
      expectFieldError(await as('get', path, adminToken), field);
    });

    it('a valid leap day is accepted', async () => {
      await as('get', '/attendance/flags/low?from=2028-02-29&to=2028-03-01', adminToken).expect(
        200,
      );
    });
  });

  describe('roll_number', () => {
    const body = (roll_number: number) => ({
      full_name: 'DTO Bounds Roll',
      class_section_id: SEED_SECTION_1_ID,
      date_of_birth: '2010-01-01',
      roll_number,
    });

    it.each([100000, 2147483648])(
      'POST /students with roll_number %i is 400 naming it',
      async (n) => {
        expectFieldError(await as('post', '/students', adminToken).send(body(n)), /^roll_number /);
      },
    );

    it('POST 99999 is 201, then PATCH 100000 is 400 and PATCH 99999 is 200', async () => {
      const created = await as('post', '/students', adminToken).send(body(99999)).expect(201);
      const id = created.body.id;
      expectFieldError(
        await as('patch', `/students/${id}`, adminToken).send({ roll_number: 100000 }),
        /^roll_number /,
      );
      await as('patch', `/students/${id}`, adminToken).send({ roll_number: 99999 }).expect(200);
    });
  });

  describe('list limit', () => {
    // The repro for the ticket: this used to return 200 with every row.
    it('GET /students?limit=100000 is 400', async () => {
      expectFieldError(await as('get', '/students?limit=100000', adminToken), /^limit /);
    });

    it.each(LIST_ROUTES)('GET %s?limit=101 is 400', async (route) => {
      expectFieldError(await as('get', `${route}?limit=101`, adminToken), /^limit /);
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
    it('POST /fee-structures with amount one over MONEY_MAX is 400 naming amount', async () => {
      const res = await as('post', '/fee-structures', adminToken).send(feeStructure(100000000));
      expectFieldError(res, /^amount /);
    });

    it('POST /fee-structures with amount 10.005 (3 decimals) is 400 naming amount', async () => {
      const res = await as('post', '/fee-structures', adminToken).send(feeStructure(10.005));
      expectFieldError(res, /^amount /);
    });

    it('POST /fee-structures with amount MONEY_MAX is 201 (allowed boundary)', async () => {
      expect(MONEY_MAX).toBe(99999999.99);
      await as('post', '/fee-structures', adminToken).send(feeStructure(MONEY_MAX)).expect(201);
    });

    it('a TEACHER (no FEE_STRUCTURE_CREATE) posting an oversized amount keeps the 403', async () => {
      await as('post', '/fee-structures', teacherToken).send(feeStructure(100000000)).expect(403);
    });

    it('POST /payments/checkout with a line amount one over MONEY_MAX is 400 naming it', async () => {
      const res = await as('post', '/payments/checkout', adminToken).send({
        idempotency_key: '00000000-0000-4000-8000-0000007514d1',
        payment_method: 'CASH',
        lines: [{ student_fee_id: '00000000-0000-4000-8000-0000007514d2', amount: 100000000 }],
      });
      expectFieldError(res, /^lines\.0\.amount /);
    });

    it('POST /fees/fines with amount one over MONEY_MAX is 400 naming amount', async () => {
      const res = await as('post', '/fees/fines', adminToken).send({
        student_ids: ['00000000-0000-4000-8000-0000007514e1'],
        fee_structure_id: '00000000-0000-4000-8000-0000007514e2',
        amount: 100000000,
        note: 'bounds',
        incident_date: '2026-01-15',
      });
      expectFieldError(res, /^amount /);
    });

    it('POST /fees/bills/:id/waive with amount one over MONEY_MAX is 400 naming amount', async () => {
      const res = await as(
        'post',
        '/fees/bills/00000000-0000-4000-8000-0000007514f1/waive',
        adminToken,
      ).send({ amount: 100000000, reason: 'bounds' });
      expectFieldError(res, /^amount /);
    });

    describe('discount rules', () => {
      let studentId: string;

      // Inside a `beforeEach`: `test/setup.ts` wipes students before every
      // test, so a `beforeAll` student is gone by the time the request runs
      // (and the 400 would be "Student not found", not the `value` bound).
      beforeEach(async () => {
        const [row] = await dataSource.query(
          `INSERT INTO students (id, full_name, registration_number, roll_number, class_section_id, tenant_id, date_of_birth, preferred_communication, enrollment_status, created_at, updated_at)
           VALUES (DEFAULT, 'DTO Bounds Student', 'REG-DTO-BOUNDS-1', 7514, $1, $2, '2010-01-01', 'SMS', 'ACTIVE', NOW(), NOW())
           RETURNING id`,
          [SEED_SECTION_1_ID, SEED_TENANT_ID],
        );
        studentId = row.id;
      });

      it('POST /discount-rules FLAT value 10.123 is 400 naming value', async () => {
        const approval = await issueApprovalToken(APPROVERS[0][1]);
        const res = await as('post', '/discount-rules', adminToken)
          .set('X-Approval-Token', approval)
          .send({ student_id: studentId, kind: 'FLAT', value: 10.123, reason: 'bounds' });
        expectFieldError(res, /^value /);
      });

      it('POST /discount-rules PERCENT value 101 is still 400 naming value', async () => {
        const approval = await issueApprovalToken(APPROVERS[1][1]);
        const res = await as('post', '/discount-rules', adminToken)
          .set('X-Approval-Token', approval)
          .send({ student_id: studentId, kind: 'PERCENT', value: 101, reason: 'bounds' });
        expectFieldError(res, /^value /);
      });
    });
  });
});
