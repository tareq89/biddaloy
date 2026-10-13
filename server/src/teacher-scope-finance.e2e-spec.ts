import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UserRole } from '@biddaloy/shared';
import { AppModule } from './app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from './validation-pipe';
import {
  SEED_ACADEMIC_YEAR_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD_HASH,
  SEED_ADMIN_PASSWORD,
  SEED_CLASS_1_ID,
  SEED_TENANT_ID,
} from '@test/constants';
import {
  assignTeacherToSection,
  createTeacherScopeFixture,
  TeacherScopeFixture,
} from '@test/helpers/teacher-scope.fixture';
import { ensureFeeStructure } from '@test/helpers/fee-fixture.helper';

/**
 * Epic 75 (75.6-d): a TEACHER's fee, fine, discount, payment, communication-log and activity-log
 * reads cover only students (and guardians) in current-year assigned sections. A miss is 404 and
 * an empty scope is an empty list (D13). Every other role keeps seeing both A and B.
 */
const API = '/api/v1';

describe('Teacher scope: finance reads (75.6-d)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let fx: TeacherScopeFixture;
  let teacherToken: string;
  let adminToken: string;
  let logOfA: string;
  let logOfB: string;
  let guardianLogB: string;
  let siblingLogB: string;
  let accountantToken: string;
  let parentToken: string;
  const extraUserIds: string[] = [];

  const asRole = (token: string, role: UserRole, path: string, tenantId = SEED_TENANT_ID) =>
    supertest(app.getHttpServer())
      .get(`${API}${path}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', tenantId)
      .set('X-Role', role);
  const asTeacher = (path: string) => asRole(teacherToken, UserRole.TEACHER, path);
  const asAdmin = (path: string) => asRole(adminToken, UserRole.ADMIN, path);
  const ids = (rows: { student_id: string }[]) => rows.map((r) => r.student_id).sort();

  // A user with one membership in the seed tenant, logged in with the shared seed password.
  const loginAs = async (role: UserRole) => {
    const email = `ts-fin-${role.toLowerCase()}-${Math.random().toString(36).slice(2, 8)}@e2e.example`;
    const [user] = await dataSource.query(
      `INSERT INTO users (email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, 'TS Finance User', 'ACTIVE', NOW(), NOW()) RETURNING id`,
      [email, SEED_ADMIN_PASSWORD_HASH],
    );
    extraUserIds.push(user.id);
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())`,
      [user.id, SEED_TENANT_ID, role],
    );
    const res = await supertest(app.getHttpServer())
      .post(`${API}/auth/login`)
      .send({ email, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    return res.body.access_token as string;
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    dataSource = app.get(DataSource);

    fx = await createTeacherScopeFixture(app, dataSource);
    teacherToken = await fx.login();
    const res = await supertest(app.getHttpServer())
      .post(`${API}/auth/login`)
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    adminToken = res.body.access_token;
    accountantToken = await loginAs(UserRole.ACCOUNTANT);
    parentToken = await loginAs(UserRole.PARENT);
  }, 120000);

  afterAll(async () => {
    for (const id of extraUserIds) {
      await dataSource.query(`DELETE FROM user_tenants WHERE user_id = $1`, [id]);
      await dataSource.query(`DELETE FROM users WHERE id = $1`, [id]);
    }
    await fx?.cleanup();
    await app?.close();
  });

  beforeEach(async () => {
    await fx.seed();
    const tuition = await ensureFeeStructure(dataSource);
    const [fine] = await dataSource.query(
      `INSERT INTO fee_structures
         (id, fee_type, name, amount, class_id, academic_year_id, tenant_id, created_at, updated_at)
       VALUES (DEFAULT, 'FINE', 'TS Fine', 50, $1, $2, $3, NOW(), NOW()) RETURNING id`,
      [SEED_CLASS_1_ID, SEED_ACADEMIC_YEAR_ID, SEED_TENANT_ID],
    );
    for (const studentId of [fx.studentA, fx.studentB]) {
      for (const structureId of [tuition, fine.id]) {
        await dataSource.query(
          `INSERT INTO student_fees (id, student_id, academic_year_id, fee_structure_id, period_start, occurrence,
             total_amount, paid_amount, discount_amount, standing_discount_amount, one_off_discount_amount, status, reminder_threshold_date, created_at, updated_at)
           VALUES (DEFAULT, $1, $2, $3, '2020-01-01', 1, 1000, 0, 0, 0, 0, 'PENDING', '2020-02-01', NOW(), NOW())`,
          [studentId, SEED_ACADEMIC_YEAR_ID, structureId],
        );
      }
    }
    const log = async (studentId: string | null, guardianId: string | null) => {
      const [row] = await dataSource.query(
        `INSERT INTO communication_logs (tenant_id, medium, recipient_address, recipient_name, message_body, status, trigger, student_id, guardian_id, created_at, updated_at)
         VALUES ($1, 'SMS', '+8801700000000', 'TS', 'hi', 'SENT', $2, $3, $4, NOW(), NOW()) RETURNING id`,
        [SEED_TENANT_ID, studentId ? 'SINGLE_REMINDER' : 'MANUAL', studentId, guardianId],
      );
      return row.id as string;
    };
    // Guardian A is also the parent of B (siblings in different sections), with one payment each.
    await dataSource.query(
      `INSERT INTO student_guardians (student_id, guardian_id) VALUES ($1, $2)`,
      [fx.studentB, fx.guardianA],
    );
    for (const [studentId, amount] of [
      [fx.studentA, 100],
      [fx.studentB, 200],
    ] as const) {
      await dataSource.query(
        `INSERT INTO payments (student_id, total_amount, payment_method, payment_date, tenant_id, created_at, updated_at)
         VALUES ($1, $2, 'CASH', NOW(), $3, NOW(), NOW())`,
        [studentId, amount, SEED_TENANT_ID],
      );
    }
    siblingLogB = await log(fx.studentB, fx.guardianA);
    logOfA = await log(fx.studentA, fx.guardianA);
    logOfB = await log(fx.studentB, fx.guardianB);
    guardianLogB = await log(null, fx.guardianB);
  });

  afterEach(async () => {
    await dataSource.query(`DELETE FROM communication_logs WHERE recipient_name = 'TS'`);
    await dataSource.query(`DELETE FROM payments WHERE student_id = ANY($1)`, [
      [fx.studentA, fx.studentB],
    ]);
    await dataSource.query(`DELETE FROM student_fees WHERE student_id = ANY($1)`, [
      [fx.studentA, fx.studentB],
    ]);
    await dataSource.query(`DELETE FROM fee_structures WHERE name = 'TS Fine'`);
  });

  describe('TEACHER (assigned to A only)', () => {
    // Failing repro of the ticket: before 75.6-d this returned both students.
    it('a teacher of section A gets no dues for a student of section B', async () => {
      const res = await asTeacher('/fees/dues?limit=100').expect(200);
      const ours = res.body.data.filter((d: { student_id: string }) =>
        [fx.studentA, fx.studentB].includes(d.student_id),
      );
      expect(ids(ours)).toEqual([fx.studentA]);
      // Staff DTO rows are unchanged for a TEACHER.
      expect(ours[0].dues[0]).toHaveProperty('reminder_threshold_date');
    });

    it('/fees/dues/flagged includes A only', async () => {
      const res = await asTeacher('/fees/dues/flagged?limit=100').expect(200);
      expect(ids(res.body.data)).toEqual([fx.studentA]);
    });

    it('/fees/fines includes A only', async () => {
      const res = await asTeacher('/fees/fines?limit=100').expect(200);
      expect(ids(res.body.items)).toEqual([fx.studentA]);
      // Totals cover only the one in-scope fine (1000), not A's and B's (2000).
      expect(res.body.totals.charged).toBe(1000);
    });

    it('/students/:id/discount-rules is 200 for A, 404 for B', async () => {
      await asTeacher(`/students/${fx.studentA}/discount-rules`).expect(200);
      await asTeacher(`/students/${fx.studentB}/discount-rules`).expect(404);
    });

    it('/payments/cart is 404 when any student is out of scope, 200 for A alone', async () => {
      await asTeacher(`/payments/cart?student_ids=${fx.studentA},${fx.studentB}`).expect(404);
      await asTeacher(`/payments/cart?student_ids=${fx.studentA}`).expect(200);
    });

    it('/payments/guardian/:id is 200 for A, 404 for B', async () => {
      // Guardian A is linked to A and B: the sibling's payment must be dropped.
      const res = await asTeacher(`/payments/guardian/${fx.guardianA}`).expect(200);
      expect(ids(res.body)).toEqual([fx.studentA]);
      await asTeacher(`/payments/guardian/${fx.guardianB}`).expect(404);
    });

    it('communication history by student and guardian: 404 for B', async () => {
      await asTeacher(`/communications/student/${fx.studentA}`).expect(200);
      await asTeacher(`/communications/student/${fx.studentB}`).expect(404);
      const own = await asTeacher(`/communications/guardian/${fx.guardianA}`).expect(200);
      // Guardian A's log about sibling B is hidden; the log about A stays.
      expect(own.body.map((l: { id: string }) => l.id)).toEqual([logOfA]);
      expect(own.body.map((l: { id: string }) => l.id)).not.toContain(siblingLogB);
      await asTeacher(`/communications/guardian/${fx.guardianB}`).expect(404);
    });

    it('/communications/:id is 200 for A, 404 for the logs of B (student- and guardian-owned)', async () => {
      const ok = await asTeacher(`/communications/${logOfA}`).expect(200);
      expect(ok.body).not.toHaveProperty('student_id');
      expect(ok.body).not.toHaveProperty('guardian_id');
      await asTeacher(`/communications/${logOfB}`).expect(404);
      await asTeacher(`/communications/${guardianLogB}`).expect(404);
    });

    it('/communications/last-reminders returns only the entry of A', async () => {
      const res = await asTeacher(
        `/communications/last-reminders?student_ids=${fx.studentA},${fx.studentB}`,
      ).expect(200);
      expect(ids(res.body)).toEqual([fx.studentA]);
    });

    it('/audit-logs/entity: Student A is 200; Student B and any Payment id are 404', async () => {
      await asTeacher(`/audit-logs/entity/Student/${fx.studentA}`).expect(200);
      await asTeacher(`/audit-logs/entity/Student/${fx.studentB}`).expect(404);
      await asTeacher(`/audit-logs/entity/Payment/${fx.studentA}`).expect(404);
    });

    it('a teacher with no assignment gets an empty /fees/dues', async () => {
      await dataSource.query(`DELETE FROM teacher_class_sections`);
      const res = await asTeacher('/fees/dues?limit=100').expect(200);
      expect(res.body.data).toEqual([]);
    });

    it('an assignment to section B flips the visible student', async () => {
      await dataSource.query(`DELETE FROM teacher_class_sections`);
      await assignTeacherToSection(dataSource, fx.teacherUserId, fx.sectionB);
      const res = await asTeacher('/fees/dues/flagged?limit=100').expect(200);
      expect(ids(res.body.data)).toEqual([fx.studentB]);
    });

    // A tenant the teacher has no membership in is refused by the context guard (401 today).
    it("tenant isolation: another tenant's X-Tenant-ID is refused", async () => {
      await asRole(
        teacherToken,
        UserRole.TEACHER,
        '/fees/dues',
        '00000000-0000-4000-8000-0000000000ff',
      ).expect(401);
    });
  });

  describe('ADMIN and ACCOUNTANT keep seeing everything', () => {
    for (const [name, role] of [
      ['ADMIN', UserRole.ADMIN],
      ['ACCOUNTANT', UserRole.ACCOUNTANT],
    ] as const) {
      it(`${name}: dues, flagged, fines, cart, payments, communications and audit cover A and B`, async () => {
        const token = role === UserRole.ADMIN ? adminToken : accountantToken;
        const get = (path: string) => asRole(token, role, path);
        const both = [fx.studentA, fx.studentB].sort();
        const ours = (rows: { student_id: string }[]) =>
          rows.filter((r) => both.includes(r.student_id));
        expect(ids(ours((await get('/fees/dues?limit=100').expect(200)).body.data))).toEqual(both);
        expect(
          ids(ours((await get('/fees/dues/flagged?limit=100').expect(200)).body.data)),
        ).toEqual(both);
        const fines = await get('/fees/fines?limit=100').expect(200);
        expect(ids(ours(fines.body.items))).toEqual(both);
        expect(fines.body.totals.charged).toBeGreaterThanOrEqual(2000);
        await get(`/students/${fx.studentB}/discount-rules`).expect(200);
        await get(`/payments/cart?student_ids=${fx.studentA},${fx.studentB}`).expect(200);
        // Both siblings' payments come back (the TEACHER filter must not touch other roles).
        expect(ids((await get(`/payments/guardian/${fx.guardianA}`).expect(200)).body)).toEqual(
          both,
        );
        await get(`/communications/student/${fx.studentB}`).expect(200);
        const guardianLogs = await get(`/communications/guardian/${fx.guardianA}`).expect(200);
        expect(guardianLogs.body.map((l: { id: string }) => l.id).sort()).toEqual(
          [logOfA, siblingLogB].sort(),
        );
        await get(`/communications/guardian/${fx.guardianB}`).expect(200);
        await get(`/communications/${logOfB}`).expect(200);
        await get(`/communications/${guardianLogB}`).expect(200);
        // Section C is a past-year section: still visible to tenant-wide roles.
        await get(`/students/${fx.studentC}/discount-rules`).expect(200);
        await get(`/payments/cart?student_ids=${fx.studentC}`).expect(200);
        await get(`/audit-logs/entity/Student/${fx.studentB}`).expect(200);
      });
    }
  });

  describe('PARENT', () => {
    // Family contract unchanged: a parent linked to nobody is refused on the cart (403, not 404).
    it('keeps the 403 on /payments/cart for a student they are not linked to', async () => {
      await asRole(
        parentToken,
        UserRole.PARENT,
        `/payments/cart?student_ids=${fx.studentA}`,
      ).expect(403);
    });
  });
});
