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
    // many e2e specs, so `ON CONFLICT (tenant_id, user_id)` reuses its profile instead
    // of erroring on the second file to run.
    await dataSource.query(
      `WITH sp AS (
         INSERT INTO staff_profiles (id, user_id, tenant_id, employee_id, created_at, updated_at)
         VALUES (gen_random_uuid(), $2::uuid, $3::uuid, 'EMP-E2E-' || $1, NOW(), NOW())
         ON CONFLICT (tenant_id, user_id) DO UPDATE SET updated_at = NOW()
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

  it('404s assign for a TEACHER not mapped to the target section (D13)', async () => {
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
      .expect(404);
  });

  // [75.6-c] D2/D13: teacher scope is current-year assignments only; a miss is 404.
  describe('teacher scope', () => {
    const asTeacher = (req: supertest.Test) =>
      req
        .set('Authorization', `Bearer ${teacherToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.TEACHER);

    const createAndAssign = async () => {
      const created = await asTeacher(supertest(app.getHttpServer()).post('/api/v1/homework'))
        .send({
          subject_id: subjectId,
          class_id: SEED_CLASS_1_ID,
          title: 'Scope homework',
          grading_mode: HomeworkGradingMode.TICK,
        })
        .expect(201);
      const assigned = await asTeacher(
        supertest(app.getHttpServer()).post(`/api/v1/homework/${created.body.id}/assign`),
      )
        .send({
          section_id: MAPPED_SECTION_ID,
          assigned_date: '2026-01-01',
          due_date: '2026-01-08',
        })
        .expect(201);
      return { homeworkId: created.body.id as string, assignmentId: assigned.body.id as string };
    };

    const unassignTeacher = () => dataSource.query(`DELETE FROM teacher_class_sections`);

    // Extra sections this describe adds to SEED_CLASS_1_ID. class_sections is only reset once
    // per file, so afterEach removes them (students first: that FK has no cascade;
    // homework_assignments cascade).
    const extraSectionIds: string[] = [];
    const mkSectionB = async (): Promise<string> => {
      const [{ id }] = await dataSource.query(
        `INSERT INTO class_sections (id, section_name, class_id, tenant_id, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, NOW(), NOW()) RETURNING id`,
        [`HW-B-${randomUUID().slice(0, 8)}`, SEED_CLASS_1_ID, TENANT_ID],
      );
      extraSectionIds.push(id);
      return id;
    };
    afterEach(async () => {
      if (!extraSectionIds.length) return;
      await dataSource.query(`DELETE FROM students WHERE class_section_id = ANY($1::uuid[])`, [
        extraSectionIds,
      ]);
      await dataSource.query(`DELETE FROM class_sections WHERE id = ANY($1::uuid[])`, [
        extraSectionIds,
      ]);
      extraSectionIds.length = 0;
    });

    const mkStudent = async (sectionId: string): Promise<string> => {
      const id = randomUUID();
      await dataSource.query(
        `INSERT INTO students (id, full_name, registration_number, roll_number, class_section_id, tenant_id, enrollment_status, created_at, updated_at)
         VALUES ($1, 'Scope Student', $2, 1, $3, $4, 'ACTIVE', NOW(), NOW())`,
        [id, `HW-STU-${randomUUID().slice(0, 8)}`, sectionId, TENANT_ID],
      );
      return id;
    };

    const adminToken = async (): Promise<string> =>
      (
        await supertest(app.getHttpServer())
          .post('/api/v1/auth/login')
          .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
          .expect(200)
      ).body.access_token as string;
    const withAdmin = (req: supertest.Test, token: string) =>
      req.set('Authorization', `Bearer ${token}`).set('X-Tenant-ID', TENANT_ID);
    const mkHomework = async (title: string): Promise<string> =>
      (
        await withAdmin(supertest(app.getHttpServer()).post('/api/v1/homework'), await adminToken())
          .send({
            subject_id: subjectId,
            class_id: SEED_CLASS_1_ID,
            title,
            grading_mode: HomeworkGradingMode.TICK,
          })
          .expect(201)
      ).body.id as string;
    const assignAsAdmin = async (
      homeworkId: string,
      target: { section_id?: string; student_id?: string },
    ) => {
      await withAdmin(
        supertest(app.getHttpServer()).post(`/api/v1/homework/${homeworkId}/assign`),
        await adminToken(),
      )
        .send({ ...target, assigned_date: '2026-01-01', due_date: '2026-01-08' })
        .expect(201);
    };
    const mkAssigned = async (
      title: string,
      target: { section_id?: string; student_id?: string },
    ) => {
      const id = await mkHomework(title);
      await assignAsAdmin(id, target);
      return id;
    };

    it("a teacher assigned only in a past academic year cannot read that class's homework analytics", async () => {
      const [{ id: teacherId }] = await dataSource.query(
        `SELECT id FROM teachers WHERE tenant_id = $1 AND user_id = $2`,
        [TENANT_ID, SEED_ADMIN_USER_ID],
      );
      const [{ id: yearId }] = await dataSource.query(
        `INSERT INTO academic_years (id, name, start_date, end_date, is_current, tenant_id, created_at, updated_at)
         VALUES (gen_random_uuid(), 'HW Past Year', '2020-01-01', '2020-12-31', false, $1, NOW(), NOW()) RETURNING id`,
        [TENANT_ID],
      );
      const [{ id: classId }] = await dataSource.query(
        `INSERT INTO classes (id, name, academic_year_id, tenant_id, created_at, updated_at)
         VALUES (gen_random_uuid(), 'HW Past Class', $1, $2, NOW(), NOW()) RETURNING id`,
        [yearId, TENANT_ID],
      );
      const [{ id: oldSectionId }] = await dataSource.query(
        `INSERT INTO class_sections (id, section_name, class_id, tenant_id, created_at, updated_at)
         VALUES (gen_random_uuid(), 'Old', $1, $2, NOW(), NOW()) RETURNING id`,
        [classId, TENANT_ID],
      );
      await dataSource.query(
        `INSERT INTO teacher_class_sections (id, teacher_id, section_id, tenant_id, created_at)
         VALUES ($1, $2, $3, $4, NOW())`,
        [randomUUID(), teacherId, oldSectionId, TENANT_ID],
      );
      await asTeacher(
        supertest(app.getHttpServer()).get(`/api/v1/homework/analytics/section/${oldSectionId}`),
      ).expect(404);
      await asTeacher(
        supertest(app.getHttpServer()).get(
          `/api/v1/homework/analytics/section/${MAPPED_SECTION_ID}`,
        ),
      ).expect(200);
    });

    it('an unassigned teacher lists nothing and gets 404 on direct fetch and update', async () => {
      const { homeworkId, assignmentId } = await createAndAssign();
      await unassignTeacher();
      const list = await asTeacher(supertest(app.getHttpServer()).get('/api/v1/homework')).expect(
        200,
      );
      expect(list.body).toEqual([]);
      const miss = await asTeacher(
        supertest(app.getHttpServer()).get(`/api/v1/homework/${homeworkId}`),
      ).expect(404);
      const unknown = await asTeacher(
        supertest(app.getHttpServer()).get(`/api/v1/homework/${randomUUID()}`),
      ).expect(404);
      // D13: same body as a homework that does not exist.
      expect(miss.body.message).toBe('Homework not found');
      expect(miss.body.message).toBe(unknown.body.message);
      await asTeacher(
        supertest(app.getHttpServer()).patch(`/api/v1/homework-assignments/${assignmentId}`),
      )
        .send({ status: 'DEACTIVATED' })
        .expect(404);
    });

    it('an unassigned teacher gets 404 on the submissions grid and on grading a submission', async () => {
      const { assignmentId } = await createAndAssign();
      const studentId = randomUUID();
      await dataSource.query(
        `INSERT INTO students (id, full_name, registration_number, roll_number, class_section_id, tenant_id, enrollment_status, created_at, updated_at)
         VALUES ($1, 'Scope Student', $2, 1, $3, $4, 'ACTIVE', NOW(), NOW())`,
        [studentId, `HW-SCOPE-${randomUUID().slice(0, 8)}`, MAPPED_SECTION_ID, TENANT_ID],
      );
      const [{ id: submissionId }] = await dataSource.query(
        `INSERT INTO homework_submissions (id, assignment_id, student_id, tenant_id, status, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, 'SUBMITTED', NOW(), NOW()) RETURNING id`,
        [assignmentId, studentId, TENANT_ID],
      );
      await asTeacher(
        supertest(app.getHttpServer()).get(
          `/api/v1/homework-assignments/${assignmentId}/submissions`,
        ),
      ).expect(200);
      await unassignTeacher();
      await asTeacher(
        supertest(app.getHttpServer()).get(
          `/api/v1/homework-assignments/${assignmentId}/submissions`,
        ),
      ).expect(404);
      await asTeacher(
        supertest(app.getHttpServer()).patch(`/api/v1/homework-submissions/${submissionId}`),
      )
        .send({ status: 'DONE' })
        .expect(404);
    });

    it('a SUBJECT teacher (no homeroom row) lists only their own subject homework', async () => {
      const [{ id: teacherId }] = await dataSource.query(
        `SELECT id FROM teachers WHERE tenant_id = $1 AND user_id = $2`,
        [TENANT_ID, SEED_ADMIN_USER_ID],
      );
      const [{ id: otherSubjectId }] = await dataSource.query(
        `INSERT INTO subjects (id, tenant_id, name_en, code, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, 'Other Subject', $2, NOW(), NOW()) RETURNING id`,
        [TENANT_ID, `E2E-${randomUUID().slice(0, 8)}`],
      );
      await unassignTeacher();
      await dataSource.query(
        `INSERT INTO teacher_class_sections (id, teacher_id, section_id, tenant_id, assignment_type, subject_id, created_at)
         VALUES ($1, $2, $3, $4, 'SUBJECT_TEACHER', $5, NOW())`,
        [randomUUID(), teacherId, MAPPED_SECTION_ID, TENANT_ID, subjectId],
      );
      const admin = await supertest(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
        .expect(200);
      const asAdmin = (req: supertest.Test) =>
        req.set('Authorization', `Bearer ${admin.body.access_token}`).set('X-Tenant-ID', TENANT_ID);
      const mk = async (sid: string, title: string) =>
        (
          await asAdmin(supertest(app.getHttpServer()).post('/api/v1/homework'))
            .send({
              subject_id: sid,
              class_id: SEED_CLASS_1_ID,
              title,
              grading_mode: HomeworkGradingMode.TICK,
            })
            .expect(201)
        ).body.id as string;
      const mine = await mk(subjectId, 'Mine');
      const theirs = await mk(otherSubjectId, 'Theirs');

      const teacherList = await asTeacher(
        supertest(app.getHttpServer()).get('/api/v1/homework'),
      ).expect(200);
      expect(teacherList.body.map((h: { id: string }) => h.id)).toEqual([mine]);
      // By id agrees with the list.
      await asTeacher(supertest(app.getHttpServer()).get(`/api/v1/homework/${theirs}`)).expect(404);
      await asTeacher(supertest(app.getHttpServer()).get(`/api/v1/homework/${mine}`)).expect(200);
      const adminList = await asAdmin(
        supertest(app.getHttpServer()).get('/api/v1/homework'),
      ).expect(200);
      expect(adminList.body.map((h: { id: string }) => h.id).sort()).toEqual([mine, theirs].sort());
    });

    it('ADMIN still reads the same homework (tenant-wide, unchanged)', async () => {
      const { homeworkId } = await createAndAssign();
      await unassignTeacher();
      const admin = await supertest(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
        .expect(200);
      await supertest(app.getHttpServer())
        .get(`/api/v1/homework/${homeworkId}`)
        .set('Authorization', `Bearer ${admin.body.access_token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(200);
    });

    it('a teacher of section A does not list homework assigned only to section B of the same class', async () => {
      const otherSectionId = await mkSectionB();
      const x = await mkAssigned('Only B', { section_id: otherSectionId });
      const y = await mkAssigned('Mine A', { section_id: MAPPED_SECTION_ID });

      const list = await asTeacher(supertest(app.getHttpServer()).get('/api/v1/homework')).expect(
        200,
      );
      const ids = list.body.map((h: { id: string }) => h.id);
      expect(ids).toContain(y);
      expect(ids).not.toContain(x);
      // Rule 2: what the list hides is 404 by id too, not just missing from the list.
      await asTeacher(supertest(app.getHttpServer()).get(`/api/v1/homework/${x}`)).expect(404);
      await asTeacher(supertest(app.getHttpServer()).get(`/api/v1/homework/${y}`)).expect(200);
    });

    it('a teacher of section A gets 404 by id for homework assigned only to a student of section B', async () => {
      const sectionB = await mkSectionB();
      const studentB = await mkStudent(sectionB);
      const studentA = await mkStudent(MAPPED_SECTION_ID);
      const x = await mkAssigned('Only B student', { student_id: studentB });
      const y = await mkAssigned('A student', { student_id: studentA });

      const list = await asTeacher(supertest(app.getHttpServer()).get('/api/v1/homework')).expect(
        200,
      );
      const ids = list.body.map((h: { id: string }) => h.id);
      expect(ids).toContain(y);
      expect(ids).not.toContain(x);
      const miss = await asTeacher(
        supertest(app.getHttpServer()).get(`/api/v1/homework/${x}`),
      ).expect(404);
      // D13: same text as a homework that does not exist.
      expect(miss.body.message).toBe('Homework not found');
      await asTeacher(supertest(app.getHttpServer()).get(`/api/v1/homework/${y}`)).expect(200);
    });

    it('unassigned homework in my class is 200 by id, then 404 once assigned only to section B', async () => {
      const sectionB = await mkSectionB();
      const h = await mkHomework('Not assigned yet');
      const listIds = async () =>
        (
          await asTeacher(supertest(app.getHttpServer()).get('/api/v1/homework')).expect(200)
        ).body.map((r: { id: string }) => r.id);

      await asTeacher(supertest(app.getHttpServer()).get(`/api/v1/homework/${h}`)).expect(200);
      expect(await listIds()).toContain(h);

      await assignAsAdmin(h, { section_id: sectionB });
      await asTeacher(supertest(app.getHttpServer()).get(`/api/v1/homework/${h}`)).expect(404);
      expect(await listIds()).not.toContain(h);
    });

    describe('GET /homework/:id/assignments (#1013)', () => {
      // Resolves to the body after asserting the status (a Test is thenable, so never return one).
      const list = async (
        id: string,
        as: 'admin' | 'teacher' = 'admin',
        status = 200,
      ): Promise<any> => {
        const req = supertest(app.getHttpServer()).get(`/api/v1/homework/${id}/assignments`);
        const res = await (as === 'teacher' ? asTeacher(req) : withAdmin(req, await adminToken()));
        expect(res.status).toBe(status);
        return res.body;
      };
      const reassignAsAdmin = async (assignmentId: string, due: string) =>
        withAdmin(
          supertest(app.getHttpServer()).post(
            `/api/v1/homework-assignments/${assignmentId}/reassign`,
          ),
          await adminToken(),
        )
          .send({
            section_id: MAPPED_SECTION_ID,
            assigned_date: '2026-01-01',
            due_date: due,
          })
          .expect(201);

      it('ADMIN gets ACTIVE first then SUPERSEDED, dates as YYYY-MM-DD, names for the target', async () => {
        const h = await mkHomework('List shape');
        const first = await withAdmin(
          supertest(app.getHttpServer()).post(`/api/v1/homework/${h}/assign`),
          await adminToken(),
        )
          .send({
            section_id: MAPPED_SECTION_ID,
            assigned_date: '2026-01-01',
            due_date: '2026-01-08',
          })
          .expect(201);
        await reassignAsAdmin(first.body.id, '2026-01-15');

        const body = await list(h);
        expect(body).toHaveLength(2);
        expect(body[0]).toMatchObject({
          status: 'ACTIVE',
          assigned_date: '2026-01-01',
          due_date: '2026-01-15',
          section_id: MAPPED_SECTION_ID,
          student_id: null,
          student_name: null,
          target_section_id: MAPPED_SECTION_ID,
        });
        expect(typeof body[0].section_name).toBe('string');
        expect(body[1]).toMatchObject({
          id: first.body.id,
          status: 'SUPERSEDED',
          due_date: '2026-01-08',
        });
      });

      it('a student row carries the student name and the student section', async () => {
        const studentId = await mkStudent(MAPPED_SECTION_ID);
        const h = await mkAssigned('List student', { student_id: studentId });
        const body = await list(h);
        expect(body).toHaveLength(1);
        expect(body[0]).toMatchObject({
          student_name: 'Scope Student',
          section_id: null,
          student_id: studentId,
          target_section_id: MAPPED_SECTION_ID,
        });
      });

      it('Rule 2: a teacher sees only rows in own sections; ADMIN sees all', async () => {
        const sectionB = await mkSectionB();
        const h = await mkAssigned('List scope', { section_id: MAPPED_SECTION_ID });
        await assignAsAdmin(h, { section_id: sectionB });

        const teacher = await list(h, 'teacher');
        expect(teacher.map((r: { target_section_id: string }) => r.target_section_id)).toEqual([
          MAPPED_SECTION_ID,
        ]);
        expect(await list(h)).toHaveLength(2);
      });

      it('D3: a SUBJECT_TEACHER sees rows only of homework in their subject', async () => {
        const [{ id: teacherId }] = await dataSource.query(
          `SELECT id FROM teachers WHERE tenant_id = $1 AND user_id = $2`,
          [TENANT_ID, SEED_ADMIN_USER_ID],
        );
        const [{ id: otherSubjectId }] = await dataSource.query(
          `INSERT INTO subjects (id, tenant_id, name_en, code, created_at, updated_at)
           VALUES (gen_random_uuid(), $1, 'Other Subject', $2, NOW(), NOW()) RETURNING id`,
          [TENANT_ID, `E2E-${randomUUID().slice(0, 8)}`],
        );
        const own = await mkAssigned('List own subject', { section_id: MAPPED_SECTION_ID });
        const other = (
          await withAdmin(
            supertest(app.getHttpServer()).post('/api/v1/homework'),
            await adminToken(),
          )
            .send({
              subject_id: otherSubjectId,
              class_id: SEED_CLASS_1_ID,
              title: 'List other subject',
              grading_mode: HomeworkGradingMode.TICK,
            })
            .expect(201)
        ).body.id as string;
        await assignAsAdmin(other, { section_id: MAPPED_SECTION_ID });
        await unassignTeacher();
        await dataSource.query(
          `INSERT INTO teacher_class_sections (id, teacher_id, section_id, tenant_id, assignment_type, subject_id, created_at)
           VALUES ($1, $2, $3, $4, 'SUBJECT_TEACHER', $5, NOW())`,
          [randomUUID(), teacherId, MAPPED_SECTION_ID, TENANT_ID, subjectId],
        );

        expect(await list(own, 'teacher')).toHaveLength(1);
        await list(other, 'teacher', 404);
      });

      it('Rule 2: out-of-scope homework is the same 404 as a random id, also after unassigning', async () => {
        const sectionB = await mkSectionB();
        const hB = await mkAssigned('List only B', { section_id: sectionB });
        const missing = await list(randomUUID(), 'teacher', 404);
        const hidden = await list(hB, 'teacher', 404);
        expect(hidden.message).toBe('Homework not found');
        expect(missing.message).toBe('Homework not found');

        const visible = await mkAssigned('List visible', { section_id: MAPPED_SECTION_ID });
        await list(visible, 'teacher');
        await unassignTeacher();
        await list(visible, 'teacher', 404);
      });

      it('a homework not assigned yet lists as an empty array', async () => {
        const h = await mkHomework('List unassigned');
        expect(await list(h)).toEqual([]);
        expect(await list(h, 'teacher')).toEqual([]);
      });

      it('D5: a row whose student was soft-deleted is not listed', async () => {
        const studentId = await mkStudent(MAPPED_SECTION_ID);
        const h = await mkAssigned('List soft delete', { student_id: studentId });
        await dataSource.query(`UPDATE students SET deleted_at = NOW() WHERE id = $1`, [studentId]);
        expect(await list(h)).toEqual([]);
      });

      it('cross-tenant: other tenant 404, missing tenant header 401', async () => {
        const h = await mkHomework('List tenant');
        const OTHER_TENANT = '00000000-0000-4000-8000-000000000098';
        await dataSource.query(
          `INSERT INTO schools (id, name, slug, created_at, updated_at)
           VALUES ($1, 'Other', 'other-hw-list', NOW(), NOW()) ON CONFLICT DO NOTHING`,
          [OTHER_TENANT],
        );
        await dataSource.query(
          `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
           VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
          [SEED_ADMIN_USER_ID, OTHER_TENANT, UserRole.ADMIN],
        );
        try {
          const token = await adminToken(); // re-login: token carries memberships
          await supertest(app.getHttpServer())
            .get(`/api/v1/homework/${h}/assignments`)
            .set('Authorization', `Bearer ${token}`)
            .set('X-Tenant-ID', OTHER_TENANT)
            .expect(404);
          await supertest(app.getHttpServer())
            .get(`/api/v1/homework/${h}/assignments`)
            .set('Authorization', `Bearer ${token}`)
            .expect(401);
        } finally {
          await dataSource.query(`DELETE FROM user_tenants WHERE user_id = $1 AND tenant_id = $2`, [
            SEED_ADMIN_USER_ID,
            OTHER_TENANT,
          ]);
        }
      });

      it('Rule 3: a non-UUID id is 400', async () => {
        await list('not-a-uuid', 'admin', 400);
      });
    });
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
