import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { ExamKind, ExamStatus, UserRole } from '@biddaloy/shared';
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
 * [68.3.12] `POST /seat-plans/:id/unpublish`, `DELETE /seat-plans/:id`, and
 * the exam-schedule guard that freezes a sitting covered by a PUBLISHED plan.
 * Covers role guard (TEACHER denied), tenant isolation (tenant B admin gets
 * 404 on tenant A's plan), and the API-bypass case (PATCH the schedule
 * directly, no seat-plan screen involved).
 */
const API = '/api/v1';

describe('[68.3.12] Seat plan unpublish / delete', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  const TENANT_B = '00000000-0000-4000-8000-0000009a0001';
  const TEACHER_USER_ID = '00000000-0000-4000-8000-0000009a0002';
  const TEACHER_EMAIL = 'seat-plan-teacher@e2e.example';
  const B_ADMIN_USER_ID = '00000000-0000-4000-8000-0000009a0003';
  const B_ADMIN_EMAIL = 'seat-plan-b-admin@e2e.example';

  let adminToken: string;
  let teacherToken: string;
  let bAdminToken: string;

  const auth = (token: string, tenant = SEED_TENANT_ID) => ({
    Authorization: `Bearer ${token}`,
    'X-Tenant-ID': tenant,
  });
  const http = () => supertest(app.getHttpServer());

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
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, 'Seat Plan B School', 'seat-plan-b-school', NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [TENANT_B],
    );
    for (const [id, email, tenant, role] of [
      [TEACHER_USER_ID, TEACHER_EMAIL, SEED_TENANT_ID, UserRole.TEACHER],
      [B_ADMIN_USER_ID, B_ADMIN_EMAIL, TENANT_B, UserRole.ADMIN],
    ]) {
      await dataSource.query(
        `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
         VALUES ($1, $2, $3, 'Seat Plan User', 'ACTIVE', NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [id, email, SEED_ADMIN_PASSWORD_HASH],
      );
      await dataSource.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [id, tenant, role],
      );
    }

    const login = async (email: string): Promise<string> =>
      (
        await http()
          .post(`${API}/auth/login`)
          .send({ email, password: SEED_ADMIN_PASSWORD })
          .expect(200)
      ).body.access_token;
    adminToken = await login(SEED_ADMIN_EMAIL);
    teacherToken = await login(TEACHER_EMAIL);
    bAdminToken = await login(B_ADMIN_EMAIL);

  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  let counter = 0;

  /** A fresh sitting (far-future date, own subject) plus a DRAFT plan over it. */
  async function draftPlan(): Promise<{ planId: string; scheduleId: string; examId: string }> {
    counter += 1;
    const examId = (
      await dataSource.query(
        `INSERT INTO exams (academic_year_id, class_id, name, kind, status, tenant_id, created_at, updated_at)
         VALUES ($1, $2, 'Seat Plan Exam ' || $6::text, $3, $4, $5, NOW(), NOW()) RETURNING id`,
        [SEED_ACADEMIC_YEAR_ID, SEED_CLASS_1_ID, ExamKind.TERM, ExamStatus.DRAFT, SEED_TENANT_ID, counter],
      )
    )[0].id;
    const roomId = (
      await dataSource.query(
        `INSERT INTO rooms (room_no, capacity, tenant_id, created_at, updated_at)
         VALUES ('SP-' || $2::text, 10, $1, NOW(), NOW()) RETURNING id`,
        [SEED_TENANT_ID, counter],
      )
    )[0].id;
    const studentId = (
      await dataSource.query(
        `INSERT INTO students
           (full_name, registration_number, roll_number, class_section_id, tenant_id,
            enrollment_status, preferred_communication, created_at, updated_at)
         VALUES ('Seat Plan Student', 'SP-E2E-R' || $3::text, 9000 + $3::int, $1, $2, 'ACTIVE', 'SMS', NOW(), NOW())
         RETURNING id`,
        [SEED_SECTION_1_ID, SEED_TENANT_ID, counter],
      )
    )[0].id;
    await dataSource.query(
      `INSERT INTO enrollments
         (student_id, class_id, section_id, academic_year_id, enrollment_status, tenant_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'ACTIVE', $5, NOW(), NOW())`,
      [studentId, SEED_CLASS_1_ID, SEED_SECTION_1_ID, SEED_ACADEMIC_YEAR_ID, SEED_TENANT_ID],
    );
    const subject = (
      await dataSource.query(
        `INSERT INTO subjects (name_en, code, tenant_id, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW()) RETURNING id`,
        [`SP Subject ${counter}`, `SP-E2E-${counter}`, SEED_TENANT_ID],
      )
    )[0].id;
    const scheduleId = (
      await dataSource.query(
        `INSERT INTO exam_schedules (exam_id, subject_id, date, starts_at, ends_at, tenant_id, created_at, updated_at)
         VALUES ($1, $2, '2099-06-01', '09:00', '11:00', $3, NOW(), NOW()) RETURNING id`,
        [examId, subject, SEED_TENANT_ID],
      )
    )[0].id;
    const res = await http()
      .post(`${API}/seat-plans/generate`)
      .set(auth(adminToken))
      .send({
        name: `Plan ${counter}`,
        exam_schedule_ids: [scheduleId],
        room_ids: [roomId],
        seat_order_mode: 'SEQUENTIAL',
      })
      .expect(201);
    return { planId: res.body.plan.id, scheduleId, examId };
  }

  const publish = (planId: string) =>
    http().post(`${API}/seat-plans/${planId}/publish`).set(auth(adminToken)).send({}).expect(201);

  it('unpublishes a published plan as ADMIN, back to DRAFT', async () => {
    const { planId } = await draftPlan();
    await publish(planId);
    const res = await http()
      .post(`${API}/seat-plans/${planId}/unpublish`)
      .set(auth(adminToken))
      .expect(201);
    expect(res.body.status).toBe('DRAFT');
  });

  it('denies unpublish to a TEACHER (403)', async () => {
    const { planId } = await draftPlan();
    await publish(planId);
    await http()
      .post(`${API}/seat-plans/${planId}/unpublish`)
      .set(auth(teacherToken))
      .expect(403);
  });

  it("hides tenant A's plan from tenant B's admin (404)", async () => {
    const { planId } = await draftPlan();
    await publish(planId);
    await http()
      .post(`${API}/seat-plans/${planId}/unpublish`)
      .set(auth(bAdminToken, TENANT_B))
      .expect(404);
  });

  it('deletes a DRAFT plan (204) and refuses to delete a PUBLISHED one (409)', async () => {
    const draft = await draftPlan();
    await http().delete(`${API}/seat-plans/${draft.planId}`).set(auth(adminToken)).expect(204);
    await http().get(`${API}/seat-plans/${draft.planId}`).set(auth(adminToken)).expect(404);

    const published = await draftPlan();
    await publish(published.planId);
    await http().delete(`${API}/seat-plans/${published.planId}`).set(auth(adminToken)).expect(409);
  });

  it('refuses to move or delete a sitting in a PUBLISHED plan (API bypass), allows it once unpublished', async () => {
    const { planId, scheduleId, examId } = await draftPlan();
    await publish(planId);
    const url = `${API}/exams/${examId}/schedule/${scheduleId}`;

    const moved = await http()
      .patch(url)
      .set(auth(adminToken))
      .send({ ends_at: '12:00' })
      .expect(409);
    expect(moved.body.details?.code ?? moved.body.error?.details?.code).toBe(
      'SITTING_IN_PUBLISHED_SEAT_PLAN',
    );
    await http().delete(url).set(auth(adminToken)).expect(409);

    await http().post(`${API}/seat-plans/${planId}/unpublish`).set(auth(adminToken)).expect(201);
    await http().patch(url).set(auth(adminToken)).send({ ends_at: '12:00' }).expect(200);
  });
});
