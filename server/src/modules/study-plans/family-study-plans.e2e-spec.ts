import { randomUUID } from 'crypto';
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
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
  SEED_ACADEMIC_YEAR_ID,
  SEED_CLASS_1_ID,
  SEED_SECTION_1_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
} from '@test/constants';

/** [66.2/#2013] Family study-plan routes: linkage matrix, content, day view, tenant isolation. */
const API = '/api/v1';
const TENANT_2 = '00000000-0000-4000-8000-0000008d0002';

const USERS = {
  T: { id: '00000000-0000-4000-8000-0000008d0001', role: UserRole.TEACHER },
  PARENT: { id: '00000000-0000-4000-8000-0000008d0003', role: UserRole.PARENT },
  PARENT_OTHER: { id: '00000000-0000-4000-8000-0000008d0004', role: UserRole.PARENT },
  STUDENT: { id: '00000000-0000-4000-8000-0000008d0005', role: UserRole.STUDENT },
  STUDENT_OTHER: { id: '00000000-0000-4000-8000-0000008d0006', role: UserRole.STUDENT },
  EXECUTIVE: { id: '00000000-0000-4000-8000-0000008d0007', role: UserRole.EXECUTIVE },
  COMMITTEE: { id: '00000000-0000-4000-8000-0000008d0008', role: UserRole.COMMITTEE },
  ACCOUNTANT: { id: '00000000-0000-4000-8000-0000008d0009', role: UserRole.ACCOUNTANT },
  PARENT2: { id: '00000000-0000-4000-8000-0000008d000a', role: UserRole.PARENT },
} as const;
type Who = keyof typeof USERS;

const NOTE = 'SECRET-TEACHER-NOTE';

describe('Family study plans E2E (66.2/#2013)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  const tokens: Record<string, string> = {};
  let adminToken: string;
  let subjectId: string;
  let bareSubjectId: string;
  let teacherId: string;
  let periodId: string;
  let routineId: string;
  let studentId: string;
  let otherStudentId: string;
  let yearStart: string;
  let termId: string;

  const email = (who: string) => `fsp-e2e-${who.toLowerCase()}@e2e.example`;

  async function login(mail: string): Promise<string> {
    const res = await supertest(app.getHttpServer())
      .post(`${API}/auth/login`)
      .send({ email: mail, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    return res.body.access_token;
  }

  function as(path: string, who: Who | 'ADMIN', tenant = SEED_TENANT_ID) {
    const token = who === 'ADMIN' ? adminToken : tokens[who];
    const role = who === 'ADMIN' ? UserRole.ADMIN : USERS[who].role;
    return supertest(app.getHttpServer())
      .get(`${API}${path}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', tenant)
      .set('X-Role', role);
  }

  /** Most recent Monday on or before today (the fixture routine runs on Mondays). */
  function lastMonday(): string {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  }

  async function makeStudent(name: string, userId: string | null): Promise<string> {
    const rows = await dataSource.query(
      `INSERT INTO students
         (full_name, registration_number, roll_number, class_section_id, tenant_id, user_id,
          enrollment_status, preferred_communication, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE', 'SMS', NOW(), NOW()) RETURNING id`,
      [
        name,
        `FSP-${randomUUID().slice(0, 10)}`,
        Math.floor(Math.random() * 1000000),
        SEED_SECTION_1_ID,
        SEED_TENANT_ID,
        userId,
      ],
    );
    return rows[0].id;
  }

  async function linkGuardian(userId: string, student: string): Promise<void> {
    const g = await dataSource.query(
      `INSERT INTO guardians (user_id, full_name, relationship, tenant_id, created_at, updated_at)
       VALUES ($1, 'FSP Guardian', 'PARENT', $2, NOW(), NOW()) RETURNING id`,
      [userId, SEED_TENANT_ID],
    );
    await dataSource.query(
      `INSERT INTO student_guardians (student_id, guardian_id) VALUES ($1, $2)`,
      [student, g[0].id],
    );
  }

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
       VALUES ($1, 'Tenant Two', 'fsp-e2e-tenant-two', NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [TENANT_2],
    );
    for (const [who, u] of Object.entries(USERS)) {
      const tenant = who === 'PARENT2' ? TENANT_2 : SEED_TENANT_ID;
      await dataSource.query(
        `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'ACTIVE', NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [
          u.id,
          email(who),
          SEED_ADMIN_PASSWORD_HASH,
          who === 'T' ? 'Rahima FSP Teacher' : `FSP ${who}`,
        ],
      );
      await dataSource.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [u.id, tenant, u.role],
      );
      tokens[who] = await login(email(who));
    }
    adminToken = await login(SEED_ADMIN_EMAIL);
  }, 120000);

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // Transactional tables are reset between tests: rebuild the fixture.
    const mkSubject = async (name: string) =>
      (
        await dataSource.query(
          `INSERT INTO subjects (id, tenant_id, name_en, code, created_at, updated_at)
           VALUES ($1, $2, $3, $4, NOW(), NOW()) RETURNING id`,
          [randomUUID(), SEED_TENANT_ID, name, `FSP-${randomUUID().slice(0, 8)}`],
        )
      )[0].id as string;
    subjectId = await mkSubject('FSP Maths');
    bareSubjectId = await mkSubject('FSP Art (no plan)');
    for (const s of [subjectId, bareSubjectId]) {
      await dataSource.query(
        `INSERT INTO class_subjects (id, tenant_id, class_id, subject_id, academic_year_id, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW(), NOW())`,
        [SEED_TENANT_ID, SEED_CLASS_1_ID, s, SEED_ACADEMIC_YEAR_ID],
      );
    }

    teacherId = randomUUID();
    await dataSource.query(
      `WITH sp AS (
         INSERT INTO staff_profiles (id, user_id, tenant_id, employee_id, created_at, updated_at)
         VALUES (gen_random_uuid(), $2::uuid, $3::uuid, 'EMP-FSPE2E', NOW(), NOW())
         ON CONFLICT (user_id) DO UPDATE SET updated_at = NOW()
         RETURNING id
       )
       INSERT INTO teachers (id, user_id, employee_id, designations, tenant_id, staff_profile_id, created_at, updated_at)
       SELECT $1::uuid, $2::uuid, 'FSPE2E', '{}', $3::uuid, sp.id, NOW(), NOW() FROM sp`,
      [teacherId, USERS.T.id, SEED_TENANT_ID],
    );

    const [{ id: shiftId }] = await dataSource.query(
      `INSERT INTO shifts (id, tenant_id, name, day_starts_at, day_ends_at, sequence, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, '08:00', '13:00', 0, NOW(), NOW()) RETURNING id`,
      [SEED_TENANT_ID, `FSP E2E ${randomUUID().slice(0, 8)}`],
    );
    [{ id: periodId }] = await dataSource.query(
      `INSERT INTO period_slots (id, tenant_id, shift_id, sequence, kind, name, starts_at, ends_at, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, 1, 'CLASS', 'P1', '08:00', '08:45', NOW(), NOW()) RETURNING id`,
      [SEED_TENANT_ID, shiftId],
    );
    [{ id: routineId }] = await dataSource.query(
      `INSERT INTO routines (id, tenant_id, academic_year_id, name, state, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, 'FSP E2E', 'PUBLISHED', NOW(), NOW()) RETURNING id`,
      [SEED_TENANT_ID, SEED_ACADEMIC_YEAR_ID],
    );
    const [{ id: slotId }] = await dataSource.query(
      `INSERT INTO routine_slots (id, tenant_id, routine_id, section_id, period_slot_id, weekday, subject_id, recurrence, valid_from, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, 1, $5, 'WEEKLY', '2020-01-01', NOW(), NOW()) RETURNING id`,
      [SEED_TENANT_ID, routineId, SEED_SECTION_1_ID, periodId, subjectId],
    );
    await dataSource.query(
      `INSERT INTO routine_slot_teachers (id, tenant_id, routine_slot_id, teacher_id, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, NOW())`,
      [SEED_TENANT_ID, slotId, teacherId],
    );

    // The year starts in 2020 so many Mondays are already past.
    const [y] = await dataSource.query('SELECT start_date FROM academic_years WHERE id = $1', [
      SEED_ACADEMIC_YEAR_ID,
    ]);
    yearStart =
      typeof y.start_date === 'string' ? y.start_date : y.start_date.toISOString().slice(0, 10);
    await dataSource.query('UPDATE academic_years SET start_date = $2 WHERE id = $1', [
      SEED_ACADEMIC_YEAR_ID,
      '2020-01-01',
    ]);

    // A term around today: the plan is "current" and the schedule range stays small.
    const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
    termId = (
      await dataSource.query(
        `INSERT INTO academic_terms (id, tenant_id, academic_year_id, seq, name, start_date, end_date, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, 901, 'FSP Term', $3, $4, NOW(), NOW()) RETURNING id`,
        [SEED_TENANT_ID, SEED_ACADEMIC_YEAR_ID, day(-60), day(60)],
      )
    )[0].id;

    studentId = await makeStudent('FSP Student', USERS.STUDENT.id);
    otherStudentId = await makeStudent('FSP Other Student', USERS.STUDENT_OTHER.id);
    await linkGuardian(USERS.PARENT.id, studentId);
    await linkGuardian(USERS.PARENT_OTHER.id, otherStudentId);
  });

  afterEach(async () => {
    await dataSource.query('UPDATE academic_years SET start_date = $2 WHERE id = $1', [
      SEED_ACADEMIC_YEAR_ID,
      yearStart,
    ]);
  });

  /** A whole-year plan with 8 one-period lessons; the first two get a teacher note. */
  async function createPlan(): Promise<{ id: string; lessonIds: string[] }> {
    const lessons = Array.from({ length: 8 }, (_, i) => ({
      title: `FSP Lesson ${i + 1}`,
      periods: 1,
      ...(i < 2 ? { notes: NOTE } : {}),
    }));
    const res = await supertest(app.getHttpServer())
      .post(`${API}/study-plans`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .set('X-Role', UserRole.ADMIN)
      .send({
        section_id: SEED_SECTION_1_ID,
        subject_id: subjectId,
        academic_term_id: termId,
        lessons,
      })
      .expect(201);
    return { id: res.body.id, lessonIds: res.body.lessons.map((l: { id: string }) => l.id) };
  }

  async function markTaught(date: string): Promise<void> {
    await dataSource.query(
      `INSERT INTO lesson_deliveries
         (id, tenant_id, section_id, subject_id, date, period_slot_id, status, is_extra, auto, recorded_by_user_id, note, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'TAUGHT', false, false, $6, $7, NOW(), NOW())`,
      [SEED_TENANT_ID, SEED_SECTION_1_ID, subjectId, date, periodId, USERS.T.id, NOTE],
    );
  }

  describe('linkage matrix (both routes)', () => {
    const expectations: [Who | 'ADMIN', number][] = [
      ['PARENT', 200],
      ['PARENT_OTHER', 401],
      ['STUDENT', 200],
      ['STUDENT_OTHER', 401],
      ['ADMIN', 200],
      ['EXECUTIVE', 200],
      // Unlinked family callers get 401 (what FamilyAccessService throws today, not 403).
      // assertLinked passes non-guardian roles straight through (staff).
      ['T', 200],
      ['COMMITTEE', 403],
      ['ACCOUNTANT', 403],
    ];

    it('study-plans follows the matrix', async () => {
      for (const [who, status] of expectations) {
        const res = await as(`/students/${studentId}/study-plans`, who);
        expect(res.status, `${who} study-plans`).toBe(status);
      }
    });

    it('lessons follows the matrix', async () => {
      const date = lastMonday();
      for (const [who, status] of expectations) {
        const res = await as(`/students/${studentId}/lessons?date=${date}`, who);
        expect(res.status, `${who} lessons`).toBe(status);
      }
    });

    it('a 403 body carries no plan data', async () => {
      await createPlan();
      const res = await as(`/students/${studentId}/study-plans`, 'PARENT_OTHER').expect(401);
      expect(JSON.stringify(res.body)).not.toContain('FSP Lesson');
    });
  });

  describe('GET /students/:id/study-plans content', () => {
    it('matches the staff schedule and hides notes and unreported counts', async () => {
      const { id, lessonIds } = await createPlan();
      await markTaught(lastMonday());
      const staff = await as(`/study-plans/${id}/schedule`, 'ADMIN').expect(200);
      const res = await as(`/students/${studentId}/study-plans`, 'PARENT').expect(200);

      expect(res.body.section.class_name).toBeTruthy();
      const block = res.body.subjects.find((s: { plan_id: string }) => s.plan_id === id);
      expect(block.subject.name_en).toBe('FSP Maths');
      expect(block.last_taught).toMatchObject({ date: lastMonday() });
      expect(block.last_taught.number).toBeGreaterThanOrEqual(1);
      expect(block.next.length).toBeLessThanOrEqual(5);
      expect(block.lessons_total).toBe(8);
      expect(block.periods_behind).toBe(staff.body.summary.periods_behind);
      expect(block.lessons_behind).toBe(staff.body.summary.lessons_behind);
      expect(block.lessons_done).toBe(staff.body.summary.lessons_done);
      // D44: the owner teacher's name is visible to families.
      expect(block.teacher_names).toEqual(['Rahima FSP Teacher']);
      expect(lessonIds).toHaveLength(8);

      // A subject without a plan is listed separately.
      expect(res.body.subjects_without_plan.map((s: { id: string }) => s.id)).toContain(
        bareSubjectId,
      );

      // Notes and unreported counts never leave the server.
      const json = JSON.stringify(res.body);
      expect(json).not.toContain(NOTE);
      expect(json).not.toContain('notes');
      expect(json).not.toContain('unreported');
    });

    it("an exam marker's date is the subject's schedule date, null with no schedule", async () => {
      const { id, lessonIds } = await createPlan();
      const mkExam = async (name: string) =>
        (
          await dataSource.query(
            `INSERT INTO exams (academic_year_id, class_id, name, kind, status, tenant_id, created_at, updated_at)
             VALUES ($1, $2, $3, 'TERM', 'PROCESSED', $4, NOW(), NOW()) RETURNING id`,
            [SEED_ACADEMIC_YEAR_ID, SEED_CLASS_1_ID, name, SEED_TENANT_ID],
          )
        )[0].id as string;
      const scheduled = await mkExam('FSP Scheduled');
      const unscheduled = await mkExam('FSP Unscheduled');
      await dataSource.query(
        `INSERT INTO exam_schedules (id, tenant_id, exam_id, subject_id, date, starts_at, ends_at, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, '2026-11-20', '10:00', '12:00', NOW(), NOW())`,
        [SEED_TENANT_ID, scheduled, subjectId],
      );
      await supertest(app.getHttpServer())
        .put(`${API}/study-plans/${id}/exam-markers`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .send({
          markers: [
            { exam_id: scheduled, up_to_lesson_id: lessonIds[3] },
            { exam_id: unscheduled, up_to_lesson_id: lessonIds[5] },
          ],
        })
        .expect(200);

      const res = await as(`/students/${studentId}/study-plans`, 'STUDENT').expect(200);
      const block = res.body.subjects.find((s: { plan_id: string }) => s.plan_id === id);
      const byName = Object.fromEntries(
        block.exam_syllabus.map((e: { exam_name: string }) => [e.exam_name, e]),
      );
      expect(byName['FSP Scheduled'].exam_date).toBe('2026-11-20');
      expect(byName['FSP Scheduled'].lessons_in_syllabus).toBe(4);
      expect(byName['FSP Unscheduled'].exam_date).toBeNull();
      expect(byName['FSP Unscheduled'].lessons_in_syllabus).toBe(6);
    });
  });

  describe('GET /students/:id/lessons?date=', () => {
    it("shows the same lesson titles as the teacher's lesson-deliveries for the day", async () => {
      await createPlan();
      const date = lastMonday();
      const teacher = await as(`/lesson-deliveries?teacher=me&date=${date}`, 'T').expect(200);
      const res = await as(`/students/${studentId}/lessons?date=${date}`, 'PARENT').expect(200);

      expect(res.body).toHaveLength(1);
      const mine = teacher.body.periods[0];
      expect(res.body[0].period_slot_id).toBe(mine.period_slot_id);
      expect(res.body[0].lesson?.title).toBe(mine.lesson?.title);
      expect(res.body[0].lesson?.number).toBe(mine.lesson?.number);
      expect(res.body[0].lesson?.part).toBe(mine.lesson?.part);
      expect(res.body[0].status).toBeNull();
      expect(JSON.stringify(res.body)).not.toContain(NOTE);
    });

    it('carries the delivery status once the teacher reported the period', async () => {
      await createPlan();
      const date = lastMonday();
      await markTaught(date);
      const res = await as(`/students/${studentId}/lessons?date=${date}`, 'PARENT').expect(200);
      expect(res.body[0].status).toBe('TAUGHT');
      expect(JSON.stringify(res.body)).not.toContain(NOTE);
    });

    it('a DRAFT routine shows families nothing', async () => {
      await createPlan();
      await dataSource.query(`UPDATE routines SET state = 'DRAFT' WHERE id = $1`, [routineId]);
      const res = await as(`/students/${studentId}/lessons?date=${lastMonday()}`, 'PARENT').expect(
        200,
      );
      expect(res.body).toEqual([]);
    });

    it('rejects a missing, malformed or far-away date with 400', async () => {
      await as(`/students/${studentId}/lessons`, 'PARENT').expect(400);
      await as(`/students/${studentId}/lessons?date=nope`, 'PARENT').expect(400);
      // Impossible calendar day and date-time strings are rejected, not rolled over.
      await as(`/students/${studentId}/lessons?date=2026-02-31`, 'PARENT').expect(400);
      // An out-of-range month made `new Date(...).toISOString()` throw: 400, not 500.
      await as(`/students/${studentId}/lessons?date=2026-13-01`, 'PARENT').expect(400);
      await as(`/students/${studentId}/lessons?date=${lastMonday()}T10:00:00Z`, 'PARENT').expect(
        400,
      );
      const far = new Date(Date.now() + 40 * 86_400_000).toISOString().slice(0, 10);
      await as(`/students/${studentId}/lessons?date=${far}`, 'PARENT').expect(400);
      const past = new Date(Date.now() - 40 * 86_400_000).toISOString().slice(0, 10);
      await as(`/students/${studentId}/lessons?date=${past}`, 'PARENT').expect(400);
    });
  });

  describe('tenant isolation', () => {
    it("a tenant-2 PARENT cannot read a tenant-1 student's plans", async () => {
      await createPlan();
      for (const path of [
        `/students/${studentId}/study-plans`,
        `/students/${studentId}/lessons?date=${lastMonday()}`,
      ]) {
        const res = await as(path, 'PARENT2', TENANT_2);
        expect([401, 403, 404]).toContain(res.status);
        expect(JSON.stringify(res.body)).not.toContain('FSP Lesson');
      }
    });

    it('a missing X-Tenant-ID is rejected with 401', async () => {
      await supertest(app.getHttpServer())
        .get(`${API}/students/${studentId}/study-plans`)
        .set('Authorization', `Bearer ${tokens.PARENT}`)
        .expect(401);
    });
  });
});
