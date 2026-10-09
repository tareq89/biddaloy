import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { UserRole } from '@biddaloy/shared';
import { AppModule } from '../../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../../validation-pipe';
import {
  SEED_TENANT_ID,
  SEED_ACADEMIC_YEAR_ID,
  SEED_CLASS_1_ID,
  SEED_SECTION_1_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
} from '@test/constants';

/**
 * [48.2.09] Portal admit-card self-print: family linkage, role matrix, tenant isolation.
 * The dues / seat-plan / copy-number logic is covered by the integration spec.
 */
const API = '/api/v1';
// They hold RESULT_READ, so only the in-service FAMILY_ONLY check stops them.
const STAFF_WITH_RESULT_READ = [
  UserRole.ADMIN,
  UserRole.SUPER_ADMIN,
  UserRole.TEACHER,
  UserRole.EXECUTIVE,
  UserRole.OFFICE_STAFF,
  UserRole.EXAM_CONTROLLER,
];
// No RESULT_READ: the permission guard refuses them.
const NO_RESULT_READ = [UserRole.ACCOUNTANT, UserRole.COMMITTEE];

describe('Family admit-card self-print E2E (48.2.09)', () => {
  let app: INestApplication;
  let ds: DataSource;
  const tokens = new Map<string, string>();
  const userIds = new Map<string, string>();
  let otherTenantId: string;
  let studentId: string; // Child A: parent + student user are linked to it
  let classmateId: string;
  let otherChildParentId: string; // user id of a PARENT linked only to the classmate
  let examId: string;

  const http = () => supertest(app.getHttpServer());
  const url = (s: string, e: string) => `${API}/students/${s}/exams/${e}/admit-card`;
  const as = (role: string) => ({
    Authorization: `Bearer ${tokens.get(role)}`,
    'X-Tenant-ID': SEED_TENANT_ID,
  });

  async function login(email: string): Promise<string> {
    const res = await http()
      .post(`${API}/auth/login`)
      .send({ email, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    return res.body.access_token;
  }

  async function addUser(tenantId: string, role: UserRole, key = role.toLowerCase()) {
    const id = randomUUID();
    const email = `fac-${key}-${id}@e2e.example`;
    await ds.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'FAC E2E', 'ACTIVE', NOW(), NOW())`,
      [id, email, SEED_ADMIN_PASSWORD_HASH],
    );
    await ds.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())`,
      [id, tenantId, role],
    );
    return { id, email };
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    ds = app.get(DataSource);

    for (const role of [
      ...STAFF_WITH_RESULT_READ,
      ...NO_RESULT_READ,
      UserRole.PARENT,
      UserRole.STUDENT,
    ]) {
      if (role === UserRole.ADMIN) {
        tokens.set(role, await login(SEED_ADMIN_EMAIL));
        continue;
      }
      const u = await addUser(SEED_TENANT_ID, role);
      userIds.set(role, u.id);
      tokens.set(role, await login(u.email));
    }
    const other = await addUser(SEED_TENANT_ID, UserRole.PARENT, 'otherparent');
    otherChildParentId = other.id;
    tokens.set('OTHER_PARENT', await login(other.email));

    // A second school with its own PARENT.
    otherTenantId = (
      await ds.query(
        `INSERT INTO schools (name, name_bn, slug) VALUES ($1, 'বিদ্যালয়', $2) RETURNING id`,
        [`FAC ${randomUUID()}`, `fac-${randomUUID()}`],
      )
    )[0].id;
    const t2 = await addUser(otherTenantId, UserRole.PARENT, 't2parent');
    tokens.set('T2_PARENT', await login(t2.email));
  }, 180000);

  afterAll(async () => {
    await app.close();
  });

  const q = async (sql: string, p: unknown[]) => (await ds.query(sql, p))[0].id as string;
  const newStudent = (name: string, userId: string | null) =>
    q(
      `INSERT INTO students
         (full_name, registration_number, roll_number, class_section_id, tenant_id, user_id,
          enrollment_status, preferred_communication, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE', 'SMS', NOW(), NOW()) RETURNING id`,
      [
        name,
        `FAC-${randomUUID().slice(0, 10)}`,
        Math.floor(Math.random() * 1000000),
        SEED_SECTION_1_ID,
        SEED_TENANT_ID,
        userId,
      ],
    );
  const linkParent = async (userId: string, student: string) => {
    const g = await q(
      `INSERT INTO guardians (user_id, full_name, relationship, tenant_id, created_at, updated_at)
       VALUES ($1, 'FAC Parent', 'PARENT', $2, NOW(), NOW()) RETURNING id`,
      [userId, SEED_TENANT_ID],
    );
    await ds.query(`INSERT INTO student_guardians (student_id, guardian_id) VALUES ($1, $2)`, [
      student,
      g,
    ]);
  };

  /** The suite wipes tenant data between tests, so everything below is seeded per test. */
  beforeEach(async () => {
    studentId = await newStudent('Child A', userIds.get(UserRole.STUDENT)!);
    classmateId = await newStudent('Classmate', null);
    await linkParent(userIds.get(UserRole.PARENT)!, studentId);
    await linkParent(otherChildParentId, classmateId);

    examId = await q(
      `INSERT INTO exams (academic_year_id, class_id, name, kind, status, tenant_id, created_at, updated_at)
       VALUES ($1, $2, 'FAC Exam', 'TERM', 'PROCESSED', $3, NOW(), NOW()) RETURNING id`,
      [SEED_ACADEMIC_YEAR_ID, SEED_CLASS_1_ID, SEED_TENANT_ID],
    );
    const subject = await q(
      `INSERT INTO subjects (tenant_id, name_en, code) VALUES ($1, 'Maths', $2) RETURNING id`,
      [SEED_TENANT_ID, `M${randomUUID().slice(0, 6)}`],
    );
    const sitting = await q(
      `INSERT INTO exam_schedules (tenant_id, exam_id, subject_id, date, starts_at, ends_at)
       VALUES ($1, $2, $3, '2027-03-01', '10:00', '13:00') RETURNING id`,
      [SEED_TENANT_ID, examId, subject],
    );
    const room = await q(`INSERT INTO rooms (tenant_id, room_no) VALUES ($1, '101') RETURNING id`, [
      SEED_TENANT_ID,
    ]);
    const plan = await q(
      `INSERT INTO seat_plans (tenant_id, name, status, seat_order_mode)
       VALUES ($1, 'Plan', 'PUBLISHED', 'SEQUENTIAL') RETURNING id`,
      [SEED_TENANT_ID],
    );
    for (const s of [studentId, classmateId]) {
      // The admit-card resolver reads the student's enrollment.
      await ds.query(
        `INSERT INTO enrollments (student_id, class_id, section_id, academic_year_id, tenant_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [s, SEED_CLASS_1_ID, SEED_SECTION_1_ID, SEED_ACADEMIC_YEAR_ID, SEED_TENANT_ID],
      );
    }
    for (const [s, seat] of [
      [studentId, 'A-1'],
      [classmateId, 'A-2'],
    ]) {
      await ds.query(
        `INSERT INTO seat_allocations (tenant_id, seat_plan_id, exam_schedule_id, student_id, room_id, seat_number)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [SEED_TENANT_ID, plan, sitting, s, room, seat],
      );
    }
  });

  /** A published default template of any kind. */
  async function template(kind: string) {
    const id = await q(
      `INSERT INTO print_templates (tenant_id, document_kind, name, batch_size, draft, is_default)
       VALUES ($1, $2, $3, 10, '{}'::jsonb, true) RETURNING id`,
      [SEED_TENANT_ID, kind, `T-${randomUUID()}`],
    );
    const v = await q(
      `INSERT INTO print_template_versions (tenant_id, template_id, version, definition)
       VALUES ($1, $2, 1, '{}'::jsonb) RETURNING id`,
      [SEED_TENANT_ID, id],
    );
    await ds.query(`UPDATE print_templates SET current_version_id = $1 WHERE id = $2`, [v, id]);
  }
  const itemCount = async () =>
    Number((await ds.query(`SELECT count(*) FROM print_job_items`, []))[0].count);

  describe('family linkage (D31)', () => {
    it('PARENT linked to the student prints (200) and the copy is CONFIRMED', async () => {
      await template('EXAM_ADMIT_CARD');
      const res = await http().post(url(studentId, examId)).set(as('PARENT'));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].copy_number).toBe(1);
    });

    it('STUDENT prints for themselves (200)', async () => {
      await template('EXAM_ADMIT_CARD');
      await http().post(url(studentId, examId)).set(as('STUDENT')).expect(200);
    });

    it('PARENT of another child in the same school is refused (401) and nothing is written', async () => {
      await template('EXAM_ADMIT_CARD');
      await http().post(url(classmateId, examId)).set(as('PARENT')).expect(401);
      await http().post(url(studentId, examId)).set(as('OTHER_PARENT')).expect(401);
      expect(await itemCount()).toBe(0);
    });

    it('STUDENT for a classmate is refused (401)', async () => {
      await template('EXAM_ADMIT_CARD');
      await http().post(url(classmateId, examId)).set(as('STUDENT')).expect(401);
      expect(await itemCount()).toBe(0);
    });
  });

  describe('role matrix', () => {
    for (const role of STAFF_WITH_RESULT_READ) {
      it(`${role} is refused with 403 FAMILY_ONLY and nothing is written`, async () => {
        await template('EXAM_ADMIT_CARD');
        const res = await http().post(url(studentId, examId)).set(as(role));
        expect(res.status, JSON.stringify(res.body)).toBe(403);
        expect(res.body.details?.code ?? res.body.message?.details?.code).toBe('FAMILY_ONLY');
        expect(await itemCount()).toBe(0);
      });
    }
    for (const role of NO_RESULT_READ) {
      it(`${role} is refused by the permission guard (403)`, async () => {
        await template('EXAM_ADMIT_CARD');
        await http().post(url(studentId, examId)).set(as(role)).expect(403);
      });
    }
  });

  describe('cannot be redirected to another document', () => {
    it('with only a staff-card and a TC default present: 409 NO_ADMIT_CARD_TEMPLATE, no job', async () => {
      await template('STUDENT_ID_CARD');
      await template('TRANSFER_CERTIFICATE');
      await template('STAFF_ID_CARD');
      const res = await http().post(url(studentId, examId)).set(as('PARENT'));
      expect(res.status).toBe(409);
      expect(await itemCount()).toBe(0);
      expect((await ds.query(`SELECT 1 FROM print_jobs`, [])).length).toBe(0);
    });
  });

  describe('tenant isolation', () => {
    it("a PARENT of tenant 2 using tenant 1's ids is refused and nothing is written", async () => {
      await template('EXAM_ADMIT_CARD');
      const res = await http()
        .post(url(studentId, examId))
        .set({ Authorization: `Bearer ${tokens.get('T2_PARENT')}`, 'X-Tenant-ID': otherTenantId });
      expect([401, 404]).toContain(res.status);
      expect(await itemCount()).toBe(0);
    });

    it('a missing X-Tenant-ID is 401', async () => {
      await http()
        .post(url(studentId, examId))
        .set({ Authorization: `Bearer ${tokens.get('PARENT')}` })
        .expect(401);
    });
  });

  it('the printed copy appears once in GET /print-history for ADMIN, CONFIRMED', async () => {
    await template('EXAM_ADMIT_CARD');
    await http().post(url(studentId, examId)).set(as('PARENT')).expect(200);
    const res = await http()
      .get(`${API}/print-history`)
      .query({ subject_id: studentId })
      .set(as('ADMIN'))
      .expect(200);
    const rows = res.body.items ?? res.body.data ?? res.body;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ job_status: 'CONFIRMED', copy_number: 1 });
  });
});
