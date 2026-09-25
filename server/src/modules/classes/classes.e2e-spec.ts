import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { DataSource } from 'typeorm';
import { UserRole, EnrollmentStatus, TeacherDesignation } from '@biddaloy/shared';
import { Student } from '../students/entities/student.entity';
import { Enrollment } from '../students/entities/enrollment.entity';
import { Teacher } from '../academics/entities/teacher.entity';
import { TeacherClassSection } from '../academics/entities/teacher-class-section.entity';
import { User } from '../users/entities/user.entity';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_USER_ID,
  SEED_ACADEMIC_YEAR_ID,
  SEED_ADMIN_PASSWORD,
} from '@test/constants';

/**
 * E2E tests for Class & Section endpoints.
 *
 * Tests nested CRUD operations: classes under an academic year,
 * sections under a class, with tenant isolation and RBAC.
 */

describe('Classes & Sections E2E', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let adminToken: string;

  const TENANT_ID = SEED_TENANT_ID;

  beforeAll(async () => {
    console.log('[classes.e2e] beforeAll called');
    process.env.DATABASE_URL =
      process.env.DATABASE_URL || 'postgres://postgres:***@localhost:5432/biddaloy';
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-production';
    process.env.NODE_ENV = 'test';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();

    dataSource = app.get(DataSource);

    const loginRes = await supertest(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: SEED_ADMIN_EMAIL, password: 'password123' })
      .expect(200);
    adminToken = loginRes.body.access_token;
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  describe('POST /classes', () => {
    it('should create a class under an academic year (ADMIN role)', async () => {
      const res = await supertest(app.getHttpServer())
        .post('/api/v1/classes')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ name: 'Class One', academic_year_id: SEED_ACADEMIC_YEAR_ID })
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.name).toBe('Class One');
      expect(res.body.tenant_id).toBe(TENANT_ID);
    });

    it('should return 401 without X-Tenant-ID header', async () => {
      const res = await supertest(app.getHttpServer())
        .post('/api/v1/classes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'No Tenant', academic_year_id: SEED_ACADEMIC_YEAR_ID })
        .expect(401);

      expect(res.body.message).toBe('X-Tenant-ID header is required');
    });

    it('should return 403 for STUDENT role', async () => {
      // Insert STUDENT role for the user
      await dataSource.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ('${SEED_ADMIN_USER_ID}', '${TENANT_ID}', '${UserRole.STUDENT}', NOW(), NOW())
         ON CONFLICT DO NOTHING`,
      );

      // Get a new token with the STUDENT role included
      const loginRes = await supertest(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
        .expect(200);
      const studentToken = loginRes.body.access_token;

      const res = await supertest(app.getHttpServer())
        .post('/api/v1/classes')
        .set('Authorization', `Bearer ${studentToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.STUDENT)
        .send({ name: 'Role Check', academic_year_id: SEED_ACADEMIC_YEAR_ID })
        .expect(401);

      expect(res.body.message).toContain('Requires one of roles');
    });

    it('should return 400 for invalid DTO (missing required fields)', async () => {
      const res = await supertest(app.getHttpServer())
        .post('/api/v1/classes')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({})
        .expect(400);
    });
  });

  describe('GET /classes', () => {
    it('should list classes (filter by academic_year_id)', async () => {
      const res = await supertest(app.getHttpServer())
        .get('/api/v1/classes')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .query({ academic_year_id: SEED_ACADEMIC_YEAR_ID })
        .expect(200);

      expect(res.body.data).toBeDefined();
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.total).toBeDefined();
    });
  });

  describe('GET /classes/:id', () => {
    it('should return a class by ID', async () => {
      const createRes = await supertest(app.getHttpServer())
        .post('/api/v1/classes')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ name: 'Find Class', academic_year_id: SEED_ACADEMIC_YEAR_ID })
        .expect(201);

      const res = await supertest(app.getHttpServer())
        .get(`/api/v1/classes/${createRes.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(200);

      expect(res.body.id).toBe(createRes.body.id);
      expect(res.body.name).toBe('Find Class');
    });

    it('should return 404 for a non-existent class', async () => {
      const res = await supertest(app.getHttpServer())
        .get('/api/v1/classes/00000000-0000-4000-8000-000000000000')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(404);
    });
  });

  describe('PATCH /classes/:id', () => {
    it('should update a class', async () => {
      const createRes = await supertest(app.getHttpServer())
        .post('/api/v1/classes')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ name: 'Original', academic_year_id: SEED_ACADEMIC_YEAR_ID })
        .expect(201);

      const res = await supertest(app.getHttpServer())
        .patch(`/api/v1/classes/${createRes.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ name: 'Updated Class' })
        .expect(200);

      expect(res.body.name).toBe('Updated Class');
    });
  });

  describe('DELETE /classes/:id', () => {
    it('should delete a class', async () => {
      const createRes = await supertest(app.getHttpServer())
        .post('/api/v1/classes')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ name: 'Delete Class', academic_year_id: SEED_ACADEMIC_YEAR_ID })
        .expect(201);

      await supertest(app.getHttpServer())
        .delete(`/api/v1/classes/${createRes.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(200);

      // Verify not found
      await supertest(app.getHttpServer())
        .get(`/api/v1/classes/${createRes.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(404);
    });
  });

  describe('POST /classes/:classId/sections', () => {
    it('should create a section under a class', async () => {
      const classRes = await supertest(app.getHttpServer())
        .post('/api/v1/classes')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ name: 'Section Parent', academic_year_id: SEED_ACADEMIC_YEAR_ID })
        .expect(201);

      const res = await supertest(app.getHttpServer())
        .post(`/api/v1/classes/${classRes.body.id}/sections`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ section_name: 'A', capacity: 30 })
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.section_name).toBe('A');
      expect(res.body.capacity).toBe(30);
      expect(res.body.tenant_id).toBe(TENANT_ID);
    });

    it('should return 400 for invalid DTO (missing section_name)', async () => {
      const classRes = await supertest(app.getHttpServer())
        .post('/api/v1/classes')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ name: 'Section DTO Test', academic_year_id: SEED_ACADEMIC_YEAR_ID })
        .expect(201);

      const res = await supertest(app.getHttpServer())
        .post(`/api/v1/classes/${classRes.body.id}/sections`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({})
        .expect(400);
    });
  });

  describe('GET /classes/:classId/sections', () => {
    it('should list sections of a class', async () => {
      const classRes = await supertest(app.getHttpServer())
        .post('/api/v1/classes')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ name: 'List Sections', academic_year_id: SEED_ACADEMIC_YEAR_ID })
        .expect(201);

      // Create a section first
      await supertest(app.getHttpServer())
        .post(`/api/v1/classes/${classRes.body.id}/sections`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ section_name: 'B', capacity: 25 })
        .expect(201);

      const res = await supertest(app.getHttpServer())
        .get(`/api/v1/classes/${classRes.body.id}/sections`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('PATCH /classes/:classId/sections/:sectionId', () => {
    it('should update a section', async () => {
      const classRes = await supertest(app.getHttpServer())
        .post('/api/v1/classes')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ name: 'Update Section', academic_year_id: SEED_ACADEMIC_YEAR_ID })
        .expect(201);

      const sectionRes = await supertest(app.getHttpServer())
        .post(`/api/v1/classes/${classRes.body.id}/sections`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ section_name: 'C', capacity: 20 })
        .expect(201);

      const res = await supertest(app.getHttpServer())
        .patch(`/api/v1/classes/${classRes.body.id}/sections/${sectionRes.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ section_name: 'C-Updated', capacity: 35 })
        .expect(200);

      expect(res.body.section_name).toBe('C-Updated');
      expect(res.body.capacity).toBe(35);
    });
  });

  describe('DELETE /classes/:classId/sections/:sectionId', () => {
    it('should delete a section', async () => {
      const classRes = await supertest(app.getHttpServer())
        .post('/api/v1/classes')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ name: 'Delete Section', academic_year_id: SEED_ACADEMIC_YEAR_ID })
        .expect(201);

      const sectionRes = await supertest(app.getHttpServer())
        .post(`/api/v1/classes/${classRes.body.id}/sections`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ section_name: 'D' })
        .expect(201);

      await supertest(app.getHttpServer())
        .delete(`/api/v1/classes/${classRes.body.id}/sections/${sectionRes.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(200);

      // Verify section is gone
      const listRes = await supertest(app.getHttpServer())
        .get(`/api/v1/classes/${classRes.body.id}/sections`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(200);

      expect(listRes.body.find((s: any) => s.id === sectionRes.body.id)).toBeUndefined();
    });
  });

  describe('DELETE /classes/:id — enrolled students blocked (409)', () => {
    it('returns 409 naming the enrolled-student count, not a generic failure', async () => {
      const classRes = await supertest(app.getHttpServer())
        .post('/api/v1/classes')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ name: 'Class With Enrolled Student', academic_year_id: SEED_ACADEMIC_YEAR_ID })
        .expect(201);

      const sectionRes = await supertest(app.getHttpServer())
        .post(`/api/v1/classes/${classRes.body.id}/sections`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ section_name: 'E', capacity: 30 })
        .expect(201);

      // `Student` (joined through `class_section`) is what the service's
      // delete guard counts — `POST /students` never writes an
      // `Enrollment` row, so the guard cannot rely on that table. An
      // `Enrollment` row is seeded alongside it anyway, matching
      // `classes.service.integration.spec.ts`'s `createStudentEnrolledIn`,
      // to prove the guard fires on the `Student` row alone.
      const studentRepo = dataSource.getRepository(Student);
      const enrollmentRepo = dataSource.getRepository(Enrollment);
      const student = await studentRepo.save({
        full_name: 'Enrolled Student',
        registration_number: `REG-E2E-${Math.random().toString(36).slice(2, 10)}`,
        roll_number: 901,
        class_section_id: sectionRes.body.id,
        tenant_id: TENANT_ID,
        enrollment_status: EnrollmentStatus.ACTIVE,
      });
      await enrollmentRepo.save({
        student_id: student.id,
        class_id: classRes.body.id,
        section_id: sectionRes.body.id,
        academic_year_id: SEED_ACADEMIC_YEAR_ID,
        tenant_id: TENANT_ID,
        enrollment_status: EnrollmentStatus.ACTIVE,
      });

      const res = await supertest(app.getHttpServer())
        .delete(`/api/v1/classes/${classRes.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(409);

      // The AC's own "explanation why" — the delete-blocked dialog reads
      // this message verbatim rather than showing a generic failure toast.
      expect(res.body.message).toContain('1 student');
      expect(res.body.message).toContain('still enrolled');

      // Cleanup so it doesn't linger for later tests in this file.
      await enrollmentRepo.delete({ student_id: student.id });
      await studentRepo.delete({ id: student.id });
    });
  });

  describe('GET /classes/:classId/teachers', () => {
    it('lists distinct teachers assigned to any section of the class, folding section names', async () => {
      const classRes = await supertest(app.getHttpServer())
        .post('/api/v1/classes')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ name: 'Class With Teacher', academic_year_id: SEED_ACADEMIC_YEAR_ID })
        .expect(201);

      const sectionRes = await supertest(app.getHttpServer())
        .post(`/api/v1/classes/${classRes.body.id}/sections`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ section_name: 'F', capacity: 30 })
        .expect(201);

      const userRepo = dataSource.getRepository(User);
      const teacherRepo = dataSource.getRepository(Teacher);
      const tcsRepo = dataSource.getRepository(TeacherClassSection);
      const user = await userRepo.save({
        full_name: 'Teacher E2E',
        email: `teacher-e2e-${Math.random().toString(36).slice(2, 10)}@test.com`,
      });
      const teacher = await teacherRepo.save({
        user_id: user.id,
        employee_id: `EMP-E2E-${Math.random().toString(36).slice(2, 8)}`,
        designations: [TeacherDesignation.CLASS_TEACHER],
        tenant_id: TENANT_ID,
      });
      // [9.1] `teacher_class_sections` gained a required `tenant_id` column
      // — must be set on any direct-repository insert like this one.
      await tcsRepo.save({
        teacher_id: teacher.id,
        section_id: sectionRes.body.id,
        tenant_id: TENANT_ID,
      });

      const res = await supertest(app.getHttpServer())
        .get(`/api/v1/classes/${classRes.body.id}/teachers`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      const row = res.body.find((t: any) => t.id === teacher.id);
      expect(row).toBeDefined();
      expect(row.full_name).toBe('Teacher E2E');
      expect(row.section_names).toContain('F');
      // A real array over the wire, not the raw-query text form of a
      // Postgres enum array (e.g. a string) — the MSW handler and
      // `teachers-tab.tsx`'s `.map()` both assume `designations` is
      // `TeacherDesignation[]`.
      expect(Array.isArray(row.designations)).toBe(true);
      expect(row.designations).toContain(TeacherDesignation.CLASS_TEACHER);

      // Cleanup so it doesn't linger for later tests in this file.
      await tcsRepo.delete({ teacher_id: teacher.id });
      await teacherRepo.delete({ id: teacher.id });
      await userRepo.delete({ id: user.id });
    });

    it('returns 401 for STUDENT role (read roles are ADMIN/ACCOUNTANT/EXECUTIVE/TEACHER only)', async () => {
      // `RolesGuard` (`context.guard.ts`) throws `UnauthorizedException`,
      // not `ForbiddenException`, for a role mismatch — 401, not 403 — so
      // the assertion below matches that guard's actual behaviour rather
      // than the REST convention of 403 for "authenticated but not
      // permitted". This is project-wide `RolesGuard` behaviour, not
      // something specific to this endpoint, and out of scope to change
      // here.
      // Reuses the STUDENT-role user seeded by the `POST /classes` 403
      // test above — `ON CONFLICT DO NOTHING` makes this safe to repeat.
      await dataSource.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ('${SEED_ADMIN_USER_ID}', '${TENANT_ID}', '${UserRole.STUDENT}', NOW(), NOW())
         ON CONFLICT DO NOTHING`,
      );
      const loginRes = await supertest(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
        .expect(200);
      const studentToken = loginRes.body.access_token;

      const classRes = await supertest(app.getHttpServer())
        .post('/api/v1/classes')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ name: 'Role Gated Class', academic_year_id: SEED_ACADEMIC_YEAR_ID })
        .expect(201);

      const res = await supertest(app.getHttpServer())
        .get(`/api/v1/classes/${classRes.body.id}/teachers`)
        .set('Authorization', `Bearer ${studentToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.STUDENT)
        .expect(401);

      expect(res.body.message).toContain('Requires one of roles');
    });

    it('returns 404 for a class in another tenant', async () => {
      await supertest(app.getHttpServer())
        .get('/api/v1/classes/00000000-0000-4000-8000-000000000000/teachers')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(404);
    });
  });

  describe('Section teacher assignments [29.0]', () => {
    async function seedClassSectionTeacher() {
      const classRes = await supertest(app.getHttpServer())
        .post('/api/v1/classes')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({
          name: `Assignment Class ${Math.random().toString(36).slice(2, 10)}`,
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
        })
        .expect(201);
      const sectionRes = await supertest(app.getHttpServer())
        .post(`/api/v1/classes/${classRes.body.id}/sections`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ section_name: 'G', capacity: 30 })
        .expect(201);

      const userRepo = dataSource.getRepository(User);
      const teacherRepo = dataSource.getRepository(Teacher);
      const user = await userRepo.save({
        full_name: 'Assignment Teacher',
        email: `assignment-teacher-${Math.random().toString(36).slice(2, 10)}@test.com`,
      });
      const teacher = await teacherRepo.save({
        user_id: user.id,
        employee_id: `EMP-ASN-${Math.random().toString(36).slice(2, 8)}`,
        designations: [TeacherDesignation.CLASS_TEACHER],
        tenant_id: TENANT_ID,
      });

      return {
        classId: classRes.body.id,
        sectionId: sectionRes.body.id,
        teacherId: teacher.id,
        cleanup: async () => {
          await teacherRepo.delete({ id: teacher.id });
          await userRepo.delete({ id: user.id });
        },
      };
    }

    it('full round trip: POST assigns, GET lists, DELETE removes', async () => {
      const { classId, sectionId, teacherId, cleanup } = await seedClassSectionTeacher();

      const assignRes = await supertest(app.getHttpServer())
        .post(`/api/v1/classes/${classId}/sections/${sectionId}/teachers`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ teacher_id: teacherId })
        .expect(201);
      expect(assignRes.body.teacher_id).toBe(teacherId);
      expect(assignRes.body.subject_id).toBeNull();

      const listRes = await supertest(app.getHttpServer())
        .get(`/api/v1/classes/${classId}/sections/${sectionId}/teachers`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(200);
      expect(listRes.body.some((row: any) => row.id === assignRes.body.id)).toBe(true);

      await supertest(app.getHttpServer())
        .delete(`/api/v1/classes/${classId}/sections/${sectionId}/teachers/${assignRes.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(200);

      const listAfterDelete = await supertest(app.getHttpServer())
        .get(`/api/v1/classes/${classId}/sections/${sectionId}/teachers`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(200);
      expect(listAfterDelete.body.some((row: any) => row.id === assignRes.body.id)).toBe(false);

      await cleanup();
    });

    it('returns 401 for a non-ADMIN role (permission-denied)', async () => {
      const { classId, sectionId, teacherId, cleanup } = await seedClassSectionTeacher();

      await dataSource.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ('${SEED_ADMIN_USER_ID}', '${TENANT_ID}', '${UserRole.TEACHER}', NOW(), NOW())
         ON CONFLICT DO NOTHING`,
      );
      const loginRes = await supertest(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
        .expect(200);
      const teacherRoleToken = loginRes.body.access_token;

      const res = await supertest(app.getHttpServer())
        .post(`/api/v1/classes/${classId}/sections/${sectionId}/teachers`)
        .set('Authorization', `Bearer ${teacherRoleToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.TEACHER)
        .send({ teacher_id: teacherId })
        .expect(401);
      expect(res.body.message).toContain('Requires one of roles');

      await cleanup();
    });

    it('[migration] DB rejects two different teachers both class-teacher for the same section', async () => {
      const { sectionId, teacherId, cleanup } = await seedClassSectionTeacher();

      const userRepo = dataSource.getRepository(User);
      const teacherRepo = dataSource.getRepository(Teacher);
      const secondUser = await userRepo.save({
        full_name: 'Second Class Teacher',
        email: `second-teacher-${Math.random().toString(36).slice(2, 10)}@test.com`,
      });
      const secondTeacher = await teacherRepo.save({
        user_id: secondUser.id,
        employee_id: `EMP-2ND-${Math.random().toString(36).slice(2, 8)}`,
        designations: [TeacherDesignation.CLASS_TEACHER],
        tenant_id: TENANT_ID,
      });

      // First teacher takes the class-teacher slot for this section.
      await dataSource.query(
        `INSERT INTO teacher_class_sections (teacher_id, section_id, tenant_id) VALUES ($1, $2, $3)`,
        [teacherId, sectionId, TENANT_ID],
      );

      // A *different* teacher for the same section, still `subject_id IS
      // NULL` — the pre-existing `UQ_tcs_teacher_section_no_subject` index
      // (keyed on `(teacher_id, section_id)`) does not stop this; only
      // this migration's `UQ_tcs_section_no_subject` (keyed on
      // `section_id` alone) does. Bypasses `SectionService.assignTeacher`'s
      // D3 auto-replace on purpose — this asserts the DB constraint itself,
      // the actual enforcement backstop, independent of the service guard.
      await expect(
        dataSource.query(
          `INSERT INTO teacher_class_sections (teacher_id, section_id, tenant_id) VALUES ($1, $2, $3)`,
          [secondTeacher.id, sectionId, TENANT_ID],
        ),
      ).rejects.toThrow(
        /duplicate key value violates unique constraint "UQ_tcs_section_no_subject"/,
      );

      await dataSource.query(`DELETE FROM teacher_class_sections WHERE section_id = $1`, [
        sectionId,
      ]);
      await teacherRepo.delete({ id: secondTeacher.id });
      await userRepo.delete({ id: secondUser.id });
      await cleanup();
    });
  });
});
