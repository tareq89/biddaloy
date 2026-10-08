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
  SEED_CLASS_1_ID,
  SEED_ACADEMIC_YEAR_ID,
} from '@test/constants';

/**
 * [48.2.10] `GET /students/:id/transcript` and `POST /students/:id/document-prints`:
 * the RESULT_READ role matrix, family linkage, tenant isolation and the audit row.
 */
const API = '/api/v1';
const TENANT_ID = SEED_TENANT_ID;
const TENANT_B = '00000000-0000-4000-8000-0000000c0299';

const uid = (n: number) => `00000000-0000-4000-8000-0000000c${String(n).padStart(4, '0')}`;
const email = (name: string) => `transcript-${name}@e2e.example`;

const STAFF_ALLOWED = [
  UserRole.SUPER_ADMIN,
  UserRole.ADMIN,
  UserRole.TEACHER,
  UserRole.EXECUTIVE,
  UserRole.OFFICE_STAFF,
  UserRole.EXAM_CONTROLLER,
];
const STAFF_DENIED = [UserRole.ACCOUNTANT, UserRole.COMMITTEE];

describe('[48.2.10] Transcript + document prints (HTTP)', () => {
  let app: INestApplication;
  let ds: DataSource;
  const tokens: Record<string, string> = {};
  let tenantBAdminToken: string;

  let studentId: string;
  let classmateId: string;
  let examId: string;

  const http = () =>
    supertest(app.getHttpServer()) as unknown as supertest.SuperTest<supertest.Test>;
  const as = (role: string, req: supertest.Test, tenant = TENANT_ID) =>
    req
      .set('Authorization', `Bearer ${tokens[role]}`)
      .set('X-Tenant-ID', tenant)
      .set('X-Role', role);
  const get = (role: string, id = studentId) =>
    as(
      role,
      http().get(`${API}/students/${id}/transcript?academic_year_id=${SEED_ACADEMIC_YEAR_ID}`),
    );
  const post = (role: string, body: object, id = studentId) =>
    as(role, http().post(`${API}/students/${id}/document-prints`).send(body));
  const printRows = (id: string) =>
    ds.query(
      `SELECT * FROM audit_logs WHERE entity_type = 'StudentDocumentPrint' AND entity_id = $1`,
      [id],
    );

  async function addUser(n: number, name: string, role: string, tenant = TENANT_ID) {
    await ds.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'ACTIVE', NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [uid(n), email(name), SEED_ADMIN_PASSWORD_HASH, `Transcript ${name}`],
    );
    await ds.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [uid(n), tenant, role],
    );
  }
  const login = async (mail: string, password = SEED_ADMIN_PASSWORD) =>
    (await http().post(`${API}/auth/login`).send({ email: mail, password }).expect(200)).body
      .access_token as string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    ds = app.get(DataSource);

    const staff = [...STAFF_ALLOWED, ...STAFF_DENIED];
    for (const [i, role] of staff.entries()) await addUser(i + 1, role, role);
    await addUser(20, 'parent', UserRole.PARENT);
    await addUser(21, 'other-parent', UserRole.PARENT);
    await addUser(22, 'student', UserRole.STUDENT);
    await addUser(23, 'classmate', UserRole.STUDENT);
    await ds.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, 'Transcript Other School', 'transcript-other-school-e2e', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [TENANT_B],
    );
    await addUser(30, 'tenant-b-admin', UserRole.ADMIN, TENANT_B);

    for (const role of staff) tokens[role] = await login(email(role));
    tokens.PARENT = await login(email('parent'));
    tokens.OTHER_PARENT = await login(email('other-parent'));
    tokens.STUDENT = await login(email('student'));
    tokens.CLASSMATE = await login(email('classmate'));
    tenantBAdminToken = await login(email('tenant-b-admin'));
    tokens.ADMIN_SEED = await login(SEED_ADMIN_EMAIL);
  }, 120000);

  afterAll(async () => {
    await app.close();
  });

  /** The global beforeEach truncates students/exams/results, so seed per test. */
  async function seed(): Promise<void> {
    const mkStudent = async (name: string, userId: string | null) => {
      const [s] = await ds.query(
        `INSERT INTO students
           (full_name, registration_number, roll_number, class_section_id, user_id, tenant_id,
            enrollment_status, preferred_communication, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE', 'SMS', NOW(), NOW()) RETURNING id`,
        [
          name,
          `TE-${Math.random().toString(36).slice(2, 12)}`,
          Math.floor(Math.random() * 1000000),
          SEED_SECTION_1_ID,
          userId,
          TENANT_ID,
        ],
      );
      await ds.query(
        `INSERT INTO enrollments
           (student_id, class_id, section_id, academic_year_id, enrollment_status, tenant_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'ACTIVE', $5, NOW(), NOW())`,
        [s.id, SEED_CLASS_1_ID, SEED_SECTION_1_ID, SEED_ACADEMIC_YEAR_ID, TENANT_ID],
      );
      return s.id as string;
    };
    studentId = await mkStudent('Transcript Student', uid(22));
    classmateId = await mkStudent('Transcript Classmate', uid(23));

    const [guardian] = await ds.query(
      `INSERT INTO guardians (user_id, full_name, relationship, tenant_id, created_at, updated_at)
       VALUES ($1, 'Transcript Parent', 'PARENT', $2, NOW(), NOW()) RETURNING id`,
      [uid(20), TENANT_ID],
    );
    await ds.query(`INSERT INTO student_guardians (student_id, guardian_id) VALUES ($1, $2)`, [
      studentId,
      guardian.id,
    ]);

    const [scale] = await ds.query(
      `INSERT INTO grading_scales (name, revision, academic_year_id, tenant_id, created_at, updated_at)
       VALUES ('NCTB', 1, $1, $2, NOW(), NOW()) RETURNING id`,
      [SEED_ACADEMIC_YEAR_ID, TENANT_ID],
    );
    await ds.query(
      `INSERT INTO grading_bands
         (scale_id, percent_from, percent_to, grade, gpa, is_fail, sequence, tenant_id, created_at, updated_at)
       VALUES ($1, 80, 100, 'A+', 5.00, false, 1, $2, NOW(), NOW())`,
      [scale.id, TENANT_ID],
    );
    const [subject] = await ds.query(
      `INSERT INTO subjects (name_en, code, tenant_id, created_at, updated_at)
       VALUES ('Mathematics', $1, $2, NOW(), NOW()) RETURNING id`,
      [`TE-M-${Math.random().toString(36).slice(2, 8)}`, TENANT_ID],
    );
    const [exam] = await ds.query(
      `INSERT INTO exams (academic_year_id, class_id, name, kind, status, published_at, tenant_id, created_at, updated_at)
       VALUES ($1, $2, 'Transcript Term Exam', 'TERM', 'PUBLISHED', NOW(), $3, NOW(), NOW()) RETURNING id`,
      [SEED_ACADEMIC_YEAR_ID, SEED_CLASS_1_ID, TENANT_ID],
    );
    examId = exam.id;
    for (const sid of [studentId, classmateId]) {
      const [result] = await ds.query(
        `INSERT INTO results
           (exam_id, student_id, total_marks, gpa, grade, position, is_fail,
            grading_scale_id, grading_scale_revision, rule_version, computed_at, published_at,
            tenant_id, created_at, updated_at)
         VALUES ($1, $2, 90.00, 5.00, 'A+', 1, false, $3, 1, 'nctb-v1', NOW(), NOW(), $4, NOW(), NOW())
         RETURNING id`,
        [examId, sid, scale.id, TENANT_ID],
      );
      await ds.query(
        `INSERT INTO result_subjects
           (result_id, subject_id, obtained, grade, gpa, is_fail, is_fourth_subject, tenant_id, created_at, updated_at)
         VALUES ($1, $2, 90.00, 'A+', 5.00, false, false, $3, NOW(), NOW())`,
        [result.id, subject.id, TENANT_ID],
      );
    }
  }

  const reportCard = () => ({ document: 'REPORT_CARD', exam_id: examId });

  describe('role matrix (RESULT_READ)', () => {
    it.each(STAFF_ALLOWED)(
      '%s gets the transcript (200) and can log a print (204)',
      async (role) => {
        await seed();
        const res = await get(role).expect(200);
        expect(res.body.exams).toHaveLength(1);
        await post(role, reportCard()).expect(204);
      },
    );

    it.each(STAFF_DENIED)('%s is denied both routes (403, no RESULT_READ)', async (role) => {
      await seed();
      await get(role).expect(403);
      await post(role, reportCard()).expect(403);
      expect(await printRows(studentId)).toHaveLength(0);
    });
  });

  describe('family linkage', () => {
    it('the linked PARENT and the STUDENT themself get 200 / 204', async () => {
      await seed();
      await get('PARENT').expect(200);
      await post('PARENT', reportCard()).expect(204);
      await get('STUDENT').expect(200);
      await post('STUDENT', {
        document: 'TRANSCRIPT',
        academic_year_id: SEED_ACADEMIC_YEAR_ID,
      }).expect(204);
    });

    it('a PARENT of another child is refused (401)', async () => {
      await seed();
      await get('OTHER_PARENT').expect(401);
      await post('OTHER_PARENT', reportCard()).expect(401);
      expect(await printRows(studentId)).toHaveLength(0);
    });

    it('a STUDENT cannot read or log for a classmate (401)', async () => {
      await seed();
      await get('STUDENT', classmateId).expect(401);
      await post('STUDENT', reportCard(), classmateId).expect(401);
      expect(await printRows(classmateId)).toHaveLength(0);
    });
  });

  describe('tenant isolation and validation', () => {
    it('tenant 2’s ADMIN gets 404 for tenant 1’s student, and no audit row appears anywhere', async () => {
      await seed();
      const asTenantB = (req: supertest.Test) =>
        req
          .set('Authorization', `Bearer ${tenantBAdminToken}`)
          .set('X-Tenant-ID', TENANT_B)
          .set('X-Role', UserRole.ADMIN);
      await asTenantB(
        http().get(
          `${API}/students/${studentId}/transcript?academic_year_id=${SEED_ACADEMIC_YEAR_ID}`,
        ),
      ).expect(404);
      await asTenantB(
        http().post(`${API}/students/${studentId}/document-prints`).send(reportCard()),
      ).expect(404);
      expect(await printRows(studentId)).toHaveLength(0);
    });

    it('a missing X-Tenant-ID is 401', async () => {
      await seed();
      await http()
        .get(`${API}/students/${studentId}/transcript?academic_year_id=${SEED_ACADEMIC_YEAR_ID}`)
        .set('Authorization', `Bearer ${tokens.ADMIN}`)
        .expect(401);
    });

    it('REPORT_CARD without exam_id is 400; a missing academic_year_id on the GET is 400', async () => {
      await seed();
      await post('ADMIN', { document: 'REPORT_CARD' }).expect(400);
      await post('ADMIN', { document: 'TRANSCRIPT' }).expect(400);
      await as('ADMIN', http().get(`${API}/students/${studentId}/transcript`)).expect(400);
    });
  });

  it('a POST shows up in GET /audit-logs/entity/StudentDocumentPrint/<student> for the ADMIN', async () => {
    await seed();
    await post('ADMIN', reportCard()).expect(204);

    const res = await as(
      'ADMIN',
      http().get(`${API}/audit-logs/entity/StudentDocumentPrint/${studentId}`),
    ).expect(200);

    const rows = Array.isArray(res.body) ? res.body : res.body.data;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'CREATE',
      entity_id: studentId,
      new_values: { document: 'REPORT_CARD', exam_id: examId },
    });
  });
});
