import { randomUUID } from 'crypto';
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { TENANT_SETTINGS_SCHEMA_VERSION } from '../schools/dto/tenant-settings.dto';
import { HomeworkGradingMode, UserRole } from '@biddaloy/shared';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_USER_ID,
  SEED_ADMIN_PASSWORD,
  SEED_CLASS_1_ID,
  SEED_SECTION_1_ID,
  SEED_SECTION_2_ID,
} from '@test/constants';

/**
 * E2E for the homework routes: full create -> assign -> reassign flow, and
 * the permission-denied case (a TEACHER not mapped to the target section).
 * `teachers`/`teacher_class_sections`/`subjects` are transactional tables —
 * reseeded in `beforeEach`, same pattern as `attendance.e2e-spec.ts`.
 */
describe('Homework E2E', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let teacherToken: string;
  let subjectId: string;

  const TENANT_ID = SEED_TENANT_ID;
  const MAPPED_SECTION_ID = SEED_SECTION_1_ID;
  const UNMAPPED_SECTION_ID = SEED_SECTION_2_ID;

  beforeAll(async () => {
    process.env.DATABASE_URL =
      process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/biddaloy';
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-production';
    process.env.NODE_ENV = 'test';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    await app.listen(0);

    dataSource = app.get(DataSource);

    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ('${SEED_ADMIN_USER_ID}', '${TENANT_ID}', '${UserRole.TEACHER}', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
    );
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    const teacherLoginRes = await supertest(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    teacherToken = teacherLoginRes.body.access_token;

    // `teachers`/`teacher_class_sections` are transactional — reseed every
    // test. The teacher is mapped to MAPPED_SECTION_ID as class teacher
    // (subject_id NULL) only.
    const teacherId = randomUUID();
    // `teachers.staff_profile_id` is NOT NULL ([36.1.1]) — this raw insert
    // bypasses TypeORM (so `TeacherStaffProfileSubscriber` doesn't fire),
    // hence the `staff_profiles` CTE. `SEED_ADMIN_USER_ID` is reused across
    // many e2e specs, so `ON CONFLICT (user_id)` reuses its profile instead
    // of erroring on the second file to run.
    await dataSource.query(
      `WITH sp AS (
         INSERT INTO staff_profiles (id, user_id, tenant_id, employee_id, created_at, updated_at)
         VALUES (gen_random_uuid(), $2::uuid, $3::uuid, 'EMP-E2E-' || $1, NOW(), NOW())
         ON CONFLICT (user_id) DO UPDATE SET updated_at = NOW()
         RETURNING id
       )
       INSERT INTO teachers (id, user_id, employee_id, designations, tenant_id, staff_profile_id, created_at, updated_at)
       SELECT $1::uuid, $2::uuid, 'E2E-HW-TEACHER', '{}', $3::uuid, sp.id, NOW(), NOW() FROM sp`,
      [teacherId, SEED_ADMIN_USER_ID, TENANT_ID],
    );
    await dataSource.query(
      `INSERT INTO teacher_class_sections (id, teacher_id, section_id, tenant_id, created_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [randomUUID(), teacherId, MAPPED_SECTION_ID, TENANT_ID],
    );

    const subjectRes = await dataSource.query(
      `INSERT INTO subjects (id, tenant_id, name_en, code, created_at, updated_at)
       VALUES ($1, $2, 'E2E Subject', $3, NOW(), NOW())
       RETURNING id`,
      [randomUUID(), TENANT_ID, `E2E-${randomUUID().slice(0, 8)}`],
    );
    subjectId = subjectRes[0].id;
  });

  it('create -> assign -> reassign: full flow', async () => {
    const createRes = await supertest(app.getHttpServer())
      .post('/api/v1/homework')
      .set('Authorization', `Bearer ${teacherToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .set('X-Role', UserRole.TEACHER)
      .send({
        subject_id: subjectId,
        class_id: SEED_CLASS_1_ID,
        title: 'Chapter 4 exercises',
        grading_mode: HomeworkGradingMode.MARKS,
      })
      .expect(201);

    const homeworkId = createRes.body.id;
    expect(homeworkId).toBeDefined();

    const assignRes = await supertest(app.getHttpServer())
      .post(`/api/v1/homework/${homeworkId}/assign`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .set('X-Role', UserRole.TEACHER)
      .send({
        section_id: MAPPED_SECTION_ID,
        assigned_date: '2026-01-01',
        due_date: '2026-01-08',
      })
      .expect(201);

    const assignmentId = assignRes.body.id;
    expect(assignRes.body.status).toBe('ACTIVE');

    const reassignRes = await supertest(app.getHttpServer())
      .post(`/api/v1/homework-assignments/${assignmentId}/reassign`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .set('X-Role', UserRole.TEACHER)
      .send({
        section_id: MAPPED_SECTION_ID,
        assigned_date: '2026-01-02',
        due_date: '2026-01-09',
      })
      .expect(201);

    expect(reassignRes.body.id).not.toBe(assignmentId);
    expect(reassignRes.body.status).toBe('ACTIVE');

    // The old row must now be SUPERSEDED (D20) — read back via GET /homework.
    const listRes = await supertest(app.getHttpServer())
      .get(`/api/v1/homework?class_id=${SEED_CLASS_1_ID}`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .set('X-Role', UserRole.TEACHER)
      .expect(200);
    expect(listRes.body.some((h: { id: string }) => h.id === homeworkId)).toBe(true);

    const oldRow = await dataSource.query('SELECT status FROM homework_assignments WHERE id = $1', [
      assignmentId,
    ]);
    expect(oldRow[0].status).toBe('SUPERSEDED');
  });

  it('denies assign for a TEACHER not mapped to the target section', async () => {
    const createRes = await supertest(app.getHttpServer())
      .post('/api/v1/homework')
      .set('Authorization', `Bearer ${teacherToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .set('X-Role', UserRole.TEACHER)
      .send({
        subject_id: subjectId,
        class_id: SEED_CLASS_1_ID,
        title: 'Chapter 5 exercises',
        grading_mode: HomeworkGradingMode.TICK,
      })
      .expect(201);

    await supertest(app.getHttpServer())
      .post(`/api/v1/homework/${createRes.body.id}/assign`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .set('X-Role', UserRole.TEACHER)
      .send({
        section_id: UNMAPPED_SECTION_ID,
        assigned_date: '2026-01-01',
        due_date: '2026-01-08',
      })
      .expect(403);
  });

  // [TIME-11] Guardian SMS on assign is off until the school turns it on.
  describe('assign notice switch', () => {
    const settingsUrl = `/api/v1/schools/${TENANT_ID}/settings`;
    let studentId: string;
    let guardianId: string;

    const logCount = async (): Promise<number> => {
      const rows = await dataSource.query(
        `SELECT COUNT(*)::int AS n FROM communication_logs WHERE student_id = $1`,
        [studentId],
      );
      return rows[0].n;
    };

    const assignHomework = async () => {
      const createRes = await supertest(app.getHttpServer())
        .post('/api/v1/homework')
        .set('Authorization', `Bearer ${teacherToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.TEACHER)
        .send({
          subject_id: subjectId,
          class_id: SEED_CLASS_1_ID,
          title: 'Notice switch homework',
          grading_mode: HomeworkGradingMode.TICK,
        })
        .expect(201);
      await supertest(app.getHttpServer())
        .post(`/api/v1/homework/${createRes.body.id}/assign`)
        .set('Authorization', `Bearer ${teacherToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.TEACHER)
        .send({
          section_id: MAPPED_SECTION_ID,
          assigned_date: '2026-01-01',
          due_date: '2026-01-08',
        })
        .expect(201);
    };

    beforeEach(async () => {
      await dataSource.query(`UPDATE schools SET settings = settings - 'homework' WHERE id = $1`, [
        TENANT_ID,
      ]);
      studentId = randomUUID();
      await dataSource.query(
        `INSERT INTO students (id, full_name, registration_number, roll_number, class_section_id, tenant_id, enrollment_status, created_at, updated_at)
         VALUES ($1, 'Notice Student', $2, 1, $3, $4, 'ACTIVE', NOW(), NOW())`,
        [studentId, `HW-NOTICE-${randomUUID().slice(0, 8)}`, MAPPED_SECTION_ID, TENANT_ID],
      );
      const guardian = await dataSource.query(
        `INSERT INTO guardians (full_name, relationship, phone, tenant_id, preferred_communication, is_primary_contact, created_at, updated_at)
         VALUES ('Notice Guardian', 'FATHER', '+8801700000077', $1, 'SMS', true, NOW(), NOW())
         RETURNING id`,
        [TENANT_ID],
      );
      guardianId = guardian[0].id;
      await dataSource.query(
        `INSERT INTO student_guardians (student_id, guardian_id) VALUES ($1, $2)`,
        [studentId, guardianId],
      );
    });

    // Remove this test's student, guardian and their rows so later specs on the shared
    // section (roster, defaulters, communication_logs counts) do not see them.
    afterEach(async () => {
      await dataSource.query(`DELETE FROM communication_logs WHERE student_id = $1`, [studentId]);
      await dataSource.query(`DELETE FROM homework_submissions WHERE student_id = $1`, [studentId]);
      await dataSource.query(`DELETE FROM student_guardians WHERE student_id = $1`, [studentId]);
      await dataSource.query(`DELETE FROM guardians WHERE id = $1`, [guardianId]);
      await dataSource.query(`DELETE FROM students WHERE id = $1`, [studentId]);
    });

    afterAll(async () => {
      await dataSource.query(`UPDATE schools SET settings = settings - 'homework' WHERE id = $1`, [
        TENANT_ID,
      ]);
    });

    it('settings absent: assign returns 201 and writes no CommunicationLog', async () => {
      await assignHomework();
      expect(await logCount()).toBe(0);
    });

    it('after PATCH { homework: { notifyOnAssign: true } }: assign writes a log', async () => {
      await supertest(app.getHttpServer())
        .patch(settingsUrl)
        .set('Authorization', `Bearer ${teacherToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .send({ version: TENANT_SETTINGS_SCHEMA_VERSION, homework: { notifyOnAssign: true } })
        .expect(200);

      await assignHomework();
      expect(await logCount()).toBe(1);
    });

    it('a TEACHER cannot change the switch (403)', async () => {
      await supertest(app.getHttpServer())
        .patch(settingsUrl)
        .set('Authorization', `Bearer ${teacherToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.TEACHER)
        .send({ version: TENANT_SETTINGS_SCHEMA_VERSION, homework: { notifyOnAssign: true } })
        .expect(403);
    });
  });
});
