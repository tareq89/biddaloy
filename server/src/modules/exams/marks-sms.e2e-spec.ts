import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { MarkGridState, TeacherAssignmentType, UserRole } from '@biddaloy/shared';
import { Teacher } from '../academics/entities/teacher.entity';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
  SEED_SECTION_1_ID,
} from '@test/constants';
import { seedGrid } from './marks-sms.fixture';

/**
 * [80.3.x] POST exams/:examId/marks/:sectionId/:subjectId/sms[/preview].
 * Scaffolding cloned from `marks-submit.e2e-spec.ts`.
 */
const API = '/api/v1';
const TENANT_B = '00000000-0000-4000-8000-0000080b0b01';
const TEACHER_USER = '00000000-0000-4000-8000-0000080a0001';
const TEACHER = 'msms-teacher@e2e.example';
const OTHER_TEACHER = 'msms-teacher2@e2e.example';
const TENANT_B_TEACHER = 'msms-teacher-b@e2e.example';
const ACCOUNTANT = 'msms-acc@e2e.example';
const OFFICE = 'msms-office@e2e.example';
const EXAM_CONTROLLER = 'msms-ec@e2e.example';

describe('[80.3] Marks SMS routes', () => {
  let app: INestApplication;
  let ds: DataSource;
  let http: () => supertest.SuperTest<supertest.Test>;
  const tokens: Record<string, string> = {};
  let examId: string;
  let subjectId: string;

  const addUser = async (n: number, email: string, role: UserRole, tenant: string) => {
    const id = `00000000-0000-4000-8000-0000080a000${n}`;
    await ds.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'Marks Sms User', 'ACTIVE', NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [id, email, SEED_ADMIN_PASSWORD_HASH],
    );
    await ds.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [id, tenant, role],
    );
  };
  const login = async (email: string) =>
    (
      await http()
        .post(`${API}/auth/login`)
        .send({ email, password: SEED_ADMIN_PASSWORD })
        .expect(200)
    ).body.access_token as string;
  const as = (token: string, role: UserRole, req: supertest.Test, tenant = SEED_TENANT_ID) =>
    req.set('Authorization', `Bearer ${token}`).set('X-Tenant-ID', tenant).set('X-Role', role);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    ds = app.get(DataSource);
    http = () => supertest(app.getHttpServer()) as unknown as supertest.SuperTest<supertest.Test>;

    await ds.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, 'Marks Sms Other School', 'marks-sms-other', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [TENANT_B],
    );
    const users: [number, string, UserRole, string][] = [
      [1, TEACHER, UserRole.TEACHER, SEED_TENANT_ID],
      [2, OTHER_TEACHER, UserRole.TEACHER, SEED_TENANT_ID],
      [3, TENANT_B_TEACHER, UserRole.TEACHER, TENANT_B],
      [4, ACCOUNTANT, UserRole.ACCOUNTANT, SEED_TENANT_ID],
      [5, OFFICE, UserRole.OFFICE_STAFF, SEED_TENANT_ID],
      [6, EXAM_CONTROLLER, UserRole.EXAM_CONTROLLER, SEED_TENANT_ID],
    ];
    for (const [n, email, role, tenant] of users) await addUser(n, email, role, tenant);
    tokens.admin = await login(SEED_ADMIN_EMAIL);
    for (const [, email] of users) tokens[email] = await login(email);
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  /** The global beforeEach truncates exam data: seed a grid per test. */
  async function seed(state: MarkGridState = MarkGridState.SUBMITTED) {
    const { exam, subject } = await seedGrid(ds, 1, state);
    examId = exam.id;
    subjectId = subject.id;
    const teacher = await ds.getRepository(Teacher).save({
      user_id: TEACHER_USER,
      employee_id: 'EMP-MSMS-1',
      tenant_id: SEED_TENANT_ID,
      designations: [],
    });
    await ds.query(
      `UPDATE academic_years SET is_current = true WHERE id = (SELECT academic_year_id FROM exams WHERE id = $1)`,
      [examId],
    );
    await ds.query(
      `INSERT INTO teacher_class_sections (teacher_id, section_id, tenant_id, subject_id, assignment_type)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        teacher.id,
        SEED_SECTION_1_ID,
        SEED_TENANT_ID,
        subjectId,
        TeacherAssignmentType.SUBJECT_TEACHER,
      ],
    );
  }

  const url = (suffix = '') =>
    `${API}/exams/${examId}/marks/${SEED_SECTION_1_ID}/${subjectId}/sms${suffix}`;
  const admin = (req: supertest.Test) => as(tokens.admin, UserRole.ADMIN, req);

  describe('permission matrix on preview', () => {
    const cases: [string, string, UserRole, number][] = [
      ['ADMIN', 'admin', UserRole.ADMIN, 201],
      ['EXAM_CONTROLLER', EXAM_CONTROLLER, UserRole.EXAM_CONTROLLER, 201],
      ['the grid subject teacher', TEACHER, UserRole.TEACHER, 201],
      // Teacher scope (Rule 2): a teacher with no row for this subject gets the section 404.
      ['another teacher', OTHER_TEACHER, UserRole.TEACHER, 404],
      ['ACCOUNTANT', ACCOUNTANT, UserRole.ACCOUNTANT, 403],
      ['OFFICE_STAFF', OFFICE, UserRole.OFFICE_STAFF, 403],
    ];
    for (const [label, key, role, status] of cases) {
      it(`${label} -> ${status}`, async () => {
        await seed();
        await as(tokens[key], role, http().post(url('/preview'))).expect(status);
      });
    }
  });

  it('send: ADMIN gets 201 and a batch', async () => {
    await seed();
    const res = await admin(http().post(url())).expect(201);
    expect(res.body.queued).toBe(1);
  });

  it('send: another teacher gets 404 and nothing is sent', async () => {
    await seed();
    await as(tokens[OTHER_TEACHER], UserRole.TEACHER, http().post(url())).expect(404);
    expect(await ds.query(`SELECT 1 FROM reminder_batches`)).toHaveLength(0);
  });

  it('409 with a fixed sentence for a DRAFT grid', async () => {
    await seed(MarkGridState.DRAFT);
    const res = await admin(http().post(url('/preview'))).expect(409);
    expect(JSON.stringify(res.body)).toMatch(/not submitted/i);
  });

  it('404 when the grid does not exist', async () => {
    await seed();
    // examId stands in for a subject id that has no grid
    await admin(
      http().post(`${API}/exams/${examId}/marks/${SEED_SECTION_1_ID}/${examId}/sms/preview`),
    ).expect(404);
  });

  it('400 for a non-UUID path param (Rule 3)', async () => {
    await seed();
    await admin(
      http().post(`${API}/exams/${examId}/marks/not-a-uuid/${subjectId}/sms/preview`),
    ).expect(400);
    await admin(http().post(`${API}/exams/${examId}/marks/${SEED_SECTION_1_ID}/nope/sms`)).expect(
      400,
    );
  });

  it('rejects a missing and an invalid X-Tenant-ID', async () => {
    await seed();
    const missing = await http()
      .post(url('/preview'))
      .set('Authorization', `Bearer ${tokens.admin}`);
    expect(missing.status).toBeGreaterThanOrEqual(400);
    expect(missing.status).toBeLessThan(500);
    const bad = await http()
      .post(url('/preview'))
      .set('Authorization', `Bearer ${tokens.admin}`)
      .set('X-Tenant-ID', 'not-a-uuid');
    expect(bad.status).toBeGreaterThanOrEqual(400);
    expect(bad.status).toBeLessThan(500);
  });

  it('401 without a token', async () => {
    await seed();
    await http().post(url('/preview')).expect(401);
  });

  it('another tenant’s teacher cannot reach this tenant’s grid', async () => {
    await seed();
    const res = await as(
      tokens[TENANT_B_TEACHER],
      UserRole.TEACHER,
      http().post(url('/preview')),
      TENANT_B,
    );
    expect(res.status).toBe(404);
  });

  it('same Idempotency-Key replays the answer and creates one batch', async () => {
    await seed();
    const send = () => admin(http().post(url()).set('Idempotency-Key', 'msms-replay-1'));
    const first = await send().expect(201);
    const second = await send().expect(201);
    expect(second.body).toEqual(first.body);
    expect(await ds.query(`SELECT 1 FROM reminder_batches`)).toHaveLength(1);
  });
});
