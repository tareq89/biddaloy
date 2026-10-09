import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import supertest = require('supertest');
import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { TeacherAssignmentType, UserRole } from '@biddaloy/shared';
import { Teacher } from '../academics/entities/teacher.entity';
import {
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
  SEED_ADMIN_USER_ID,
  SEED_SECTION_1_ID,
  SEED_TENANT_ID,
} from '@test/constants';

// The step-up flow echoes the OTP back only when this is set (NODE_ENV=test).
process.env.ACCOUNT_ACCESS_ECHO_SECRETS = 'true';

/**
 * [52.3.6] Who may approve / reject / cancel / bulk-approve an application, and the two
 * "effect" paths that move real data: the FEE_WAIVER discount rule (behind a step-up token)
 * and the leave ledger + attendance marks.
 *
 * A caller who cannot even SEE the application gets 404 (not 403) from every decide route,
 * so "other TEACHER" and "ACCOUNTANT" on a student leave are 404 rows here; a caller who can
 * see it but is not a decider (parent, student, office staff) gets 403 NOT_A_DECIDER.
 */
describe('Application decisions E2E', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  const API = '/api/v1/applications';

  const ids = {
    parent: randomUUID(),
    studentUser: randomUUID(),
    classTeacher: randomUUID(),
    otherTeacher: randomUUID(),
    applicantTeacher: randomUUID(),
    office: randomUUID(),
    accountant: randomUUID(),
    executive: randomUUID(),
    approver: randomUUID(), // holds FEE_APPROVE; the identity a step-up token is minted for
  };
  const TENANT_B = randomUUID();
  const emailOf = (id: string) => `app-dec-e2e-${id}@test.com`;
  const tokens: Record<string, string> = {};
  let adminToken: string;
  let childId: string;
  let applicantStaffProfileId: string;

  const day = (offset: number) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
  };
  const codeOf = (body: any): string | undefined =>
    body?.details?.code ?? body?.error?.details?.code;

  async function login(email: string): Promise<string> {
    const res = await supertest(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    return res.body.access_token;
  }
  const call = (method: 'get' | 'post', path: string, token: string, tenant = SEED_TENANT_ID) =>
    supertest(app.getHttpServer())
      [method](path)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', tenant);

  /** Step-up token for `discount_rules.manage`, minted with the SPENDER's own bearer token. */
  async function issueApprovalToken(spenderToken: string): Promise<string> {
    const identifier = emailOf(ids.approver);
    const otp = await call('post', '/api/v1/auth/step-up/otp/request', spenderToken)
      .send({ identifier })
      .expect(202);
    const verified = await call('post', '/api/v1/auth/step-up', spenderToken)
      .send({ identifier, method: 'OTP', otp: otp.body.debug.otp, scope: 'discount_rules.manage' })
      .expect(200);
    return verified.body.approval_token;
  }

  // --- fixtures: always through the real POST /applications --------------------------------
  const leavePayload = (from: number, to: number) => ({
    reason_kind: 'SICK',
    start_date: day(from),
    end_date: day(to),
    details: 'Fever, doctor advised rest',
  });
  async function fileStudentLeave(from = 2, to = 3): Promise<string> {
    const res = await call('post', API, tokens[ids.parent])
      .send({
        type: 'STUDENT_LEAVE',
        subject_student_id: childId,
        payload: leavePayload(from, to),
      })
      .expect(201);
    return res.body.id;
  }
  async function fileStaffLeave(): Promise<string> {
    const res = await call('post', API, tokens[ids.applicantTeacher])
      .send({
        type: 'STAFF_LEAVE',
        payload: {
          leave_type: 'CASUAL',
          start_date: day(5),
          end_date: day(7),
          reason: 'Family event',
        },
      })
      .expect(201);
    return res.body.id;
  }
  async function fileFeeWaiver(): Promise<string> {
    const res = await call('post', API, tokens[ids.parent])
      .send({
        type: 'FEE_WAIVER',
        subject_student_id: childId,
        payload: { kind: 'FLAT', value: 500, reason: 'Financial hardship' },
      })
      .expect(201);
    return res.body.id;
  }
  const approve = (id: string, token: string, body: object = {}, tenant = SEED_TENANT_ID) =>
    call('post', `${API}/${id}/approve`, token, tenant).send(body);

  const row = async (id: string) =>
    (
      await dataSource.query(
        `SELECT status, current_step, effect_result FROM applications WHERE id = $1`,
        [id],
      )
    )[0];
  const eventsOf = (id: string, kind: string) =>
    dataSource.query(
      `SELECT data FROM application_events WHERE application_id = $1 AND kind = $2`,
      [id, kind],
    );
  const casualBalance = async () => {
    const res = await call(
      'get',
      `/api/v1/leave/balance?staff_profile_id=${applicantStaffProfileId}`,
      adminToken,
    ).expect(200);
    return res.body.find((b: { leave_type: string }) => b.leave_type === 'CASUAL').balance;
  };

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    dataSource = app.get(DataSource);

    // Users and memberships survive the per-test reset, so create them once.
    for (const [id, name, role] of [
      [ids.parent, 'Dec Parent', UserRole.PARENT],
      [ids.studentUser, 'Dec Student', UserRole.STUDENT],
      [ids.classTeacher, 'Dec Class Teacher', UserRole.TEACHER],
      [ids.otherTeacher, 'Dec Other Teacher', UserRole.TEACHER],
      [ids.applicantTeacher, 'Dec Applicant Teacher', UserRole.TEACHER],
      [ids.office, 'Dec Office', UserRole.OFFICE_STAFF],
      [ids.accountant, 'Dec Accountant', UserRole.ACCOUNTANT],
      [ids.executive, 'Dec Executive', UserRole.EXECUTIVE],
      [ids.approver, 'Dec Approver', UserRole.ADMIN],
    ] as const) {
      await dataSource.query(
        `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'ACTIVE', NOW(), NOW())`,
        [id, emailOf(id), SEED_ADMIN_PASSWORD_HASH, name],
      );
      await dataSource.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW())`,
        [id, SEED_TENANT_ID, role],
      );
      tokens[id] = await login(emailOf(id));
    }

    // Tenant B, where the seed admin is also an ADMIN (X-Tenant-ID picks the tenant).
    await dataSource.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, 'Decisions E2E Tenant B', $2, NOW(), NOW())`,
      [TENANT_B, `decisions-e2e-b-${TENANT_B.slice(0, 8)}`],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, 'ADMIN', NOW(), NOW())`,
      [SEED_ADMIN_USER_ID, TENANT_B],
    );
    // Logged in after the B membership exists, so the token knows both tenants.
    adminToken = await login(SEED_ADMIN_EMAIL);
  }, 120000);

  afterAll(async () => {
    await dataSource.query(`DELETE FROM user_tenants WHERE tenant_id = $1`, [TENANT_B]);
    await dataSource.query(`DELETE FROM schools WHERE id = $1`, [TENANT_B]);
    await app.close();
  });

  beforeEach(async () => {
    // Students, guardians, teachers and leave policies are cleared before every test.
    const [student] = await dataSource.query(
      `INSERT INTO students (full_name, registration_number, roll_number, class_section_id, tenant_id,
                             user_id, enrollment_status, preferred_communication, created_at, updated_at)
       VALUES ('Dec Child', $1, 1, $2, $3, $4, 'ACTIVE', 'SMS', NOW(), NOW()) RETURNING id`,
      [`DEC-${randomUUID().slice(0, 10)}`, SEED_SECTION_1_ID, SEED_TENANT_ID, ids.studentUser],
    );
    childId = student.id;
    const [guardian] = await dataSource.query(
      `INSERT INTO guardians (full_name, relationship, phone, email, tenant_id, user_id,
                              preferred_communication, is_primary_contact, created_at, updated_at)
       VALUES ('Dec Guardian', 'FATHER', '+8801700000011', $1, $2, $3, 'SMS', true, NOW(), NOW()) RETURNING id`,
      [`g-${randomUUID()}@test.com`, SEED_TENANT_ID, ids.parent],
    );
    await dataSource.query(
      `INSERT INTO student_guardians (student_id, guardian_id) VALUES ($1, $2)`,
      [childId, guardian.id],
    );

    // Saving a Teacher also creates its staff profile.
    const teacherRepo = dataSource.getRepository(Teacher);
    const make = (userId: string) =>
      teacherRepo.save({
        user_id: userId,
        tenant_id: SEED_TENANT_ID,
        employee_id: `DEC-${randomUUID().slice(0, 12)}`,
        designations: [],
      });
    const classTeacher = await make(ids.classTeacher);
    await make(ids.otherTeacher);
    await make(ids.applicantTeacher);
    await dataSource.query(
      `INSERT INTO teacher_class_sections (teacher_id, section_id, tenant_id, assignment_type, created_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [classTeacher.id, SEED_SECTION_1_ID, SEED_TENANT_ID, TeacherAssignmentType.CLASS_TEACHER],
    );
    [{ id: applicantStaffProfileId }] = await dataSource.query(
      `SELECT id FROM staff_profiles WHERE user_id = $1 AND tenant_id = $2`,
      [ids.applicantTeacher, SEED_TENANT_ID],
    );
    // The seed tenant never got the migration's per-tenant leave policies.
    await dataSource.query(
      `INSERT INTO leave_policies (id, tenant_id, leave_type, annual_quota_days, created_at, updated_at)
       SELECT gen_random_uuid(), $1, v.leave_type, v.quota, NOW(), NOW()
       FROM (VALUES
         ('CASUAL'::leave_type_enum, 10), ('SICK'::leave_type_enum, 14),
         ('EARNED'::leave_type_enum, 15), ('MATERNITY'::leave_type_enum, 112),
         ('PATERNITY'::leave_type_enum, 7)
       ) AS v(leave_type, quota)
       ON CONFLICT (tenant_id, leave_type) DO UPDATE SET annual_quota_days = EXCLUDED.annual_quota_days`,
      [SEED_TENANT_ID],
    );
  });

  describe('STUDENT_LEAVE', () => {
    it('the class teacher approves it (200 APPROVED)', async () => {
      const id = await fileStudentLeave();
      const res = await approve(id, tokens[ids.classTeacher]).expect(200);
      expect(res.body.status).toBe('APPROVED');
    });

    it('an ADMIN overrides: 200, and the APPROVED event records data.override', async () => {
      const id = await fileStudentLeave();
      const res = await approve(id, adminToken).expect(200);
      expect(res.body.status).toBe('APPROVED');
      const [event] = await eventsOf(id, 'APPROVED');
      expect(event.data.override).toBe(true);
    });

    it('a viewer who is not a decider gets 403 NOT_A_DECIDER (parent, student, office)', async () => {
      const id = await fileStudentLeave();
      for (const who of [ids.parent, ids.studentUser, ids.office]) {
        const res = await approve(id, tokens[who]).expect(403);
        expect(codeOf(res.body), who).toBe('NOT_A_DECIDER');
      }
      expect((await row(id)).status).toBe('PENDING');
    });

    it('someone who cannot see it gets 404 (other TEACHER, ACCOUNTANT)', async () => {
      const id = await fileStudentLeave();
      await approve(id, tokens[ids.otherTeacher]).expect(404);
      await approve(id, tokens[ids.accountant]).expect(404);
      expect((await row(id)).status).toBe('PENDING');
    });

    it('approving writes LEAVE on the section register for each day', async () => {
      const id = await fileStudentLeave(2, 3);
      await approve(id, tokens[ids.classTeacher]).expect(200);
      // Only working days get a mark, so the handler's own list says which days to read.
      const dates = (await row(id)).effect_result.attendance_dates as string[];
      expect(dates.length).toBeGreaterThan(0);
      for (const date of dates) {
        const reg = await call(
          'get',
          `/api/v1/attendance/sections/${SEED_SECTION_1_ID}/register?date=${date}`,
          adminToken,
        ).expect(200);
        const mine = reg.body.students.find(
          (s: { student_id: string }) => s.student_id === childId,
        );
        expect(mine.status, date).toBe('LEAVE');
      }
    });
  });

  describe('STAFF_LEAVE', () => {
    it('ADMIN approves it (200)', async () => {
      const res = await approve(await fileStaffLeave(), adminToken).expect(200);
      expect(res.body.status).toBe('APPROVED');
    });

    it('EXECUTIVE approves it (200)', async () => {
      const res = await approve(await fileStaffLeave(), tokens[ids.executive]).expect(200);
      expect(res.body.status).toBe('APPROVED');
    });

    it('OFFICE_STAFF can see it but not decide (403); another TEACHER cannot see it (404)', async () => {
      const id = await fileStaffLeave();
      const res = await approve(id, tokens[ids.office]).expect(403);
      expect(codeOf(res.body)).toBe('NOT_A_DECIDER');
      await approve(id, tokens[ids.otherTeacher]).expect(404);
    });

    it('approval drops the balance by the working days; cancel gives it back', async () => {
      expect(await casualBalance()).toBe(10);
      const id = await fileStaffLeave();
      await approve(id, adminToken).expect(200);
      // Weekends are not working days, so read the count the handler recorded.
      const days = (await row(id)).effect_result.days as number;
      expect(days).toBeGreaterThan(0);
      expect(await casualBalance()).toBe(10 - days);

      // The applicant cannot cancel their own leave; office staff are not leave approvers.
      const own = await call('post', `${API}/${id}/cancel`, tokens[ids.applicantTeacher])
        .send({ reason: 'Plans changed' })
        .expect(403);
      expect(codeOf(own.body)).toBe('APPLICANT_CANNOT_CANCEL');
      const office = await call('post', `${API}/${id}/cancel`, tokens[ids.office])
        .send({ reason: 'Plans changed' })
        .expect(403);
      expect(codeOf(office.body)).toBe('NOT_A_DECIDER');
      expect(await casualBalance()).toBe(10 - days);

      const cancelled = await call('post', `${API}/${id}/cancel`, adminToken)
        .send({ reason: 'Plans changed' })
        .expect(200);
      expect(cancelled.body.status).toBe('CANCELLED');
      expect(await casualBalance()).toBe(10);
    });
  });

  describe('FEE_WAIVER (step-up money path)', () => {
    /** Class teacher passes step 0, so the waiver waits for the step-up approval. */
    async function waiverAtFinalStep(): Promise<string> {
      const id = await fileFeeWaiver();
      await approve(id, tokens[ids.classTeacher]).expect(200);
      expect((await row(id)).current_step).toBe(1);
      return id;
    }

    it('needs the token, then creates the discount rule with the GRANTED terms; the token is single-use', async () => {
      const id = await waiverAtFinalStep();
      const accountant = tokens[ids.accountant];

      // No token: refused, and the application is untouched.
      const noToken = await approve(id, accountant).expect(403);
      expect(codeOf(noToken.body)).toBe('APPROVAL_REQUIRED');
      expect((await row(id)).status).toBe('PENDING');

      // EXECUTIVE may override a step but lacks the permission the approval applies.
      const exec = await approve(id, tokens[ids.executive]).expect(403);
      expect(codeOf(exec.body)).toBe('EFFECT_PERMISSION_REQUIRED');

      // Token minted by the accountant's own bearer token, granted terms differ from the request.
      const token = await issueApprovalToken(accountant);
      const ok = await call('post', `${API}/${id}/approve`, accountant)
        .set('X-Approval-Token', token)
        .send({ granted: { kind: 'PERCENT', value: 20 } })
        .expect(200);
      expect(ok.body.status).toBe('APPROVED');

      const rules = await call(
        'get',
        `/api/v1/students/${childId}/discount-rules`,
        adminToken,
      ).expect(200);
      expect(rules.body).toHaveLength(1);
      expect(rules.body[0].kind).toBe('PERCENT');
      expect(Number(rules.body[0].value)).toBe(20);
      expect((await row(id)).effect_result.discount_rule_id).toBe(rules.body[0].id);

      // The same token on a second waiver is spent.
      const second = await waiverAtFinalStep();
      const reuse = await call('post', `${API}/${second}/approve`, accountant)
        .set('X-Approval-Token', token)
        .send({ granted: { kind: 'PERCENT', value: 20 } })
        .expect(403);
      expect(codeOf(reuse.body)).toBe('APPROVAL_REQUIRED');
      expect((await row(second)).status).toBe('PENDING');
    });
  });

  describe('reject, bulk, cancel and failure', () => {
    it('reject without a reason is a 400', async () => {
      const id = await fileStudentLeave();
      await call('post', `${API}/${id}/reject`, adminToken).send({}).expect(400);
      await call('post', `${API}/${id}/reject`, adminToken).send({ reason: '   ' }).expect(400);
      expect((await row(id)).status).toBe('PENDING');
    });

    it('bulk: 3 student leaves approve, the FEE_WAIVER is NOT_BULK_APPROVABLE', async () => {
      const leaves = [
        await fileStudentLeave(2, 2),
        await fileStudentLeave(3, 3),
        await fileStudentLeave(4, 4),
      ];
      const waiver = await fileFeeWaiver();
      const res = await call('post', `${API}/bulk-approve`, tokens[ids.classTeacher])
        .send({ ids: [...leaves, waiver] })
        .expect(200);
      const byId = new Map<string, { ok: boolean; error_code?: string }>(
        res.body.map((r: { id: string; ok: boolean; error_code?: string }) => [r.id, r]),
      );
      for (const id of leaves) expect(byId.get(id)?.ok, id).toBe(true);
      expect(byId.get(waiver)).toMatchObject({ ok: false, error_code: 'NOT_BULK_APPROVABLE' });
      expect((await row(waiver)).status).toBe('PENDING');
    });

    it('bulk with 51 ids is a 400', async () => {
      const many = Array.from({ length: 51 }, () => randomUUID());
      await call('post', `${API}/bulk-approve`, adminToken).send({ ids: many }).expect(400);
    });

    it('a final approval whose handler fails rolls back: READMISSION of an ACTIVE student is a 409', async () => {
      const filed = await call('post', API, tokens[ids.parent])
        .send({
          type: 'READMISSION',
          subject_student_id: childId,
          payload: {
            class_section_id: SEED_SECTION_1_ID,
            occurred_on: day(-1),
            reason: 'Please re-admit',
          },
        })
        .expect(201);
      await approve(filed.body.id, adminToken).expect(409);
      expect((await row(filed.body.id)).status).toBe('PENDING');
      expect(await eventsOf(filed.body.id, 'APPROVED')).toHaveLength(0);
    });
  });

  describe('tenant and authentication boundaries', () => {
    it('a tenant-B ADMIN gets 404 on every decide route for a tenant-A id', async () => {
      const id = await fileStudentLeave();
      await approve(id, adminToken, {}, TENANT_B).expect(404);
      await call('post', `${API}/${id}/reject`, adminToken, TENANT_B)
        .send({ reason: 'No' })
        .expect(404);
      await call('post', `${API}/${id}/consider`, adminToken, TENANT_B).send({}).expect(404);
      await call('post', `${API}/${id}/cancel`, adminToken, TENANT_B)
        .send({ reason: 'No' })
        .expect(404);
      // Bulk never throws for one id: the foreign id simply is not found.
      const bulk = await call('post', `${API}/bulk-approve`, adminToken, TENANT_B)
        .send({ ids: [id] })
        .expect(200);
      expect(bulk.body).toEqual([{ id, ok: false, error_code: 'NOT_FOUND' }]);
      expect((await row(id)).status).toBe('PENDING');
    });

    it('every decide route is a 401 without a bearer token', async () => {
      const id = randomUUID();
      const post = (path: string, body: object) =>
        supertest(app.getHttpServer()).post(path).set('X-Tenant-ID', SEED_TENANT_ID).send(body);
      await post(`${API}/${id}/approve`, {}).expect(401);
      await post(`${API}/${id}/reject`, { reason: 'No' }).expect(401);
      await post(`${API}/${id}/consider`, {}).expect(401);
      await post(`${API}/${id}/cancel`, { reason: 'No' }).expect(401);
      await post(`${API}/bulk-approve`, { ids: [id] }).expect(401);
    });
  });

  describe('GET /applications/reports (APPLICATION_MANAGE)', () => {
    it('is 200 for ADMIN and OFFICE_STAFF, 403 for TEACHER, ACCOUNTANT and PARENT', async () => {
      await call('get', `${API}/reports`, adminToken).expect(200);
      await call('get', `${API}/reports`, tokens[ids.office]).expect(200);
      for (const who of [ids.classTeacher, ids.accountant, ids.parent]) {
        await call('get', `${API}/reports`, tokens[who]).expect(403);
      }
    });

    it('is 401 without a bearer token', async () => {
      await supertest(app.getHttpServer())
        .get(`${API}/reports`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .expect(401);
    });
  });
});
