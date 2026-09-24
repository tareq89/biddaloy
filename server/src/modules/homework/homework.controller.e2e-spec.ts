import { randomUUID } from 'crypto';
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
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
    await dataSource.query(
      `INSERT INTO teachers (id, user_id, employee_id, designations, tenant_id, created_at, updated_at)
       VALUES ($1, $2, 'E2E-HW-TEACHER', '{}', $3, NOW(), NOW())`,
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
});
