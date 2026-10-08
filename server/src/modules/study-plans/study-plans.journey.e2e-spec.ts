import { randomUUID } from 'crypto';
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { LessonDeliveryReason, LessonDeliveryStatus, UserRole } from '@biddaloy/shared';
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
 * [66.2.99/#2014] One walk through the whole wave-2 API: template -> plan ->
 * schedule -> marking -> behind -> family view -> CSV round trip, then the
 * fences (other teacher, other child, other tenant). Each step is checked
 * against the one before it.
 */
const API = '/api/v1';
const TENANT_2 = '00000000-0000-4000-8000-0000009e0002';

const USERS = {
  T: { id: '00000000-0000-4000-8000-0000009e0001', role: UserRole.TEACHER },
  U: { id: '00000000-0000-4000-8000-0000009e0003', role: UserRole.TEACHER },
  PARENT: { id: '00000000-0000-4000-8000-0000009e0004', role: UserRole.PARENT },
  PARENT_OTHER: { id: '00000000-0000-4000-8000-0000009e0005', role: UserRole.PARENT },
  STUDENT: { id: '00000000-0000-4000-8000-0000009e0006', role: UserRole.STUDENT },
  STUDENT_OTHER: { id: '00000000-0000-4000-8000-0000009e0007', role: UserRole.STUDENT },
  ADMIN2: { id: '00000000-0000-4000-8000-0000009e0008', role: UserRole.ADMIN },
} as const;
type Who = keyof typeof USERS;

describe('Study plans journey E2E (66.2.99/#2014)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  const tokens: Record<string, string> = {};
  let adminToken: string;
  let yearStart: string;

  const email = (who: string) => `spj-e2e-${who.toLowerCase()}@e2e.example`;

  async function login(mail: string): Promise<string> {
    const res = await supertest(app.getHttpServer())
      .post(`${API}/auth/login`)
      .send({ email: mail, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    return res.body.access_token;
  }

  function as(
    method: 'get' | 'post' | 'put',
    path: string,
    who: Who | 'ADMIN',
    tenant = SEED_TENANT_ID,
  ) {
    const token = who === 'ADMIN' ? adminToken : tokens[who];
    const role = who === 'ADMIN' ? UserRole.ADMIN : USERS[who].role;
    return supertest(app.getHttpServer())
      [method](`${API}${path}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', tenant)
      .set('X-Role', role);
  }

  /** Most recent Monday on or before today, minus `weeks` (the routine runs on Mondays). */
  function mondayBack(weeks: number): string {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) - 7 * weeks);
    return d.toISOString().slice(0, 10);
  }

  async function makeTeacher(userId: string, tag: string): Promise<string> {
    const teacherId = randomUUID();
    await dataSource.query(
      `WITH sp AS (
         INSERT INTO staff_profiles (id, user_id, tenant_id, employee_id, created_at, updated_at)
         VALUES (gen_random_uuid(), $2::uuid, $3::uuid, 'EMP-SPJ-' || $4, NOW(), NOW())
         ON CONFLICT (user_id) DO UPDATE SET updated_at = NOW()
         RETURNING id
       )
       INSERT INTO teachers (id, user_id, employee_id, designations, tenant_id, staff_profile_id, created_at, updated_at)
       SELECT $1::uuid, $2::uuid, 'SPJ-' || $4, '{}', $3::uuid, sp.id, NOW(), NOW() FROM sp`,
      [teacherId, userId, SEED_TENANT_ID, tag],
    );
    return teacherId;
  }

  async function makeStudent(name: string, userId: string, guardianUserId: string) {
    const [s] = await dataSource.query(
      `INSERT INTO students
         (full_name, registration_number, roll_number, class_section_id, tenant_id, user_id,
          enrollment_status, preferred_communication, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE', 'SMS', NOW(), NOW()) RETURNING id`,
      [
        name,
        `SPJ-${randomUUID().slice(0, 10)}`,
        Math.floor(Math.random() * 1000000),
        SEED_SECTION_1_ID,
        SEED_TENANT_ID,
        userId,
      ],
    );
    const [g] = await dataSource.query(
      `INSERT INTO guardians (user_id, full_name, relationship, tenant_id, created_at, updated_at)
       VALUES ($1, 'SPJ Guardian', 'PARENT', $2, NOW(), NOW()) RETURNING id`,
      [guardianUserId, SEED_TENANT_ID],
    );
    await dataSource.query(
      `INSERT INTO student_guardians (student_id, guardian_id) VALUES ($1, $2)`,
      [s.id, g.id],
    );
    return s.id as string;
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
       VALUES ($1, 'Tenant Two', 'spj-e2e-tenant-two', NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [TENANT_2],
    );
    for (const [who, u] of Object.entries(USERS)) {
      const tenant = who === 'ADMIN2' ? TENANT_2 : SEED_TENANT_ID;
      await dataSource.query(
        `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'ACTIVE', NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [u.id, email(who), SEED_ADMIN_PASSWORD_HASH, `SPJ E2E ${who}`],
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

  afterEach(async () => {
    await dataSource.query('UPDATE academic_years SET start_date = $2 WHERE id = $1', [
      SEED_ACADEMIC_YEAR_ID,
      yearStart,
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  it('template -> plan -> schedule -> marking -> behind -> family -> CSV', async () => {
    // ---- fixture: subject, owner T on a Monday slot, a term around today, two families
    const [{ id: subjectId, code: subjectCode }] = await dataSource.query(
      `INSERT INTO subjects (id, tenant_id, name_en, code, created_at, updated_at)
       VALUES ($1, $2, 'SPJ Maths', $3, NOW(), NOW()) RETURNING id, code`,
      [randomUUID(), SEED_TENANT_ID, `SPJ-${randomUUID().slice(0, 8)}`],
    );
    await dataSource.query(
      `INSERT INTO class_subjects (id, tenant_id, class_id, subject_id, academic_year_id, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW(), NOW())`,
      [SEED_TENANT_ID, SEED_CLASS_1_ID, subjectId, SEED_ACADEMIC_YEAR_ID],
    );
    const teacherT = await makeTeacher(USERS.T.id, 'T');
    await makeTeacher(USERS.U.id, 'U');
    const [{ id: shiftId }] = await dataSource.query(
      `INSERT INTO shifts (id, tenant_id, name, day_starts_at, day_ends_at, sequence, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, '08:00', '13:00', 0, NOW(), NOW()) RETURNING id`,
      [SEED_TENANT_ID, `SPJ ${randomUUID().slice(0, 8)}`],
    );
    const period = async (seq: number) =>
      (
        await dataSource.query(
          `INSERT INTO period_slots (id, tenant_id, shift_id, sequence, kind, name, starts_at, ends_at, created_at, updated_at)
           VALUES (gen_random_uuid(), $1, $2, $3, 'CLASS', 'P', '08:00', '08:45', NOW(), NOW()) RETURNING id`,
          [SEED_TENANT_ID, shiftId, seq],
        )
      )[0].id as string;
    const periodId = await period(1);
    const freePeriodId = await period(2);
    await dataSource.query(
      `UPDATE classes SET shift_id = $2 WHERE id = (SELECT class_id FROM class_sections WHERE id = $1)`,
      [SEED_SECTION_1_ID, shiftId],
    );
    const [{ id: routineId }] = await dataSource.query(
      `INSERT INTO routines (id, tenant_id, academic_year_id, name, state, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, 'SPJ', 'PUBLISHED', NOW(), NOW()) RETURNING id`,
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
      [SEED_TENANT_ID, slotId, teacherT],
    );
    const [y] = await dataSource.query('SELECT start_date FROM academic_years WHERE id = $1', [
      SEED_ACADEMIC_YEAR_ID,
    ]);
    yearStart =
      typeof y.start_date === 'string' ? y.start_date : y.start_date.toISOString().slice(0, 10);
    await dataSource.query('UPDATE academic_years SET start_date = $2 WHERE id = $1', [
      SEED_ACADEMIC_YEAR_ID,
      '2020-01-01',
    ]);
    const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
    const [{ id: termId }] = await dataSource.query(
      `INSERT INTO academic_terms (id, tenant_id, academic_year_id, seq, name, start_date, end_date, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, 909, 'SPJ Term', $3, $4, NOW(), NOW()) RETURNING id`,
      [SEED_TENANT_ID, SEED_ACADEMIC_YEAR_ID, day(-90), day(90)],
    );
    const studentId = await makeStudent('SPJ Student', USERS.STUDENT.id, USERS.PARENT.id);
    await makeStudent('SPJ Other', USERS.STUDENT_OTHER.id, USERS.PARENT_OTHER.id);

    // ---- 1. admin builds a 12-lesson template
    const lessons = Array.from({ length: 12 }, (_, i) => ({
      title: `SPJ Lesson ${i + 1}`,
      periods: 1,
    }));
    const tpl = await as('post', '/study-plan-templates', 'ADMIN')
      .send({
        name: `SPJ Tpl ${randomUUID().slice(0, 6)}`,
        class_grade: 7,
        subject_code: subjectCode,
        lessons,
      })
      .expect(201);

    // ---- 2. owner T copies it into a plan; capacity route answers
    const copied = await as('post', `/study-plan-templates/${tpl.body.id}/copy`, 'T')
      .send({ section_id: SEED_SECTION_1_ID, subject_id: subjectId, academic_term_id: termId })
      .expect(201);
    const planId: string = copied.body.id;
    expect(copied.body.lessons).toHaveLength(12);
    await as(
      'get',
      `/study-plans/capacity?section_id=${SEED_SECTION_1_ID}&subject_id=${subjectId}&academic_term_id=${termId}`,
      'T',
    ).expect(200);

    // ---- 3. schedule before any marking
    const before = await as('get', `/study-plans/${planId}/schedule`, 'T').expect(200);
    expect(before.body.summary.lessons_total).toBe(12);
    expect(before.body.summary.periods_behind).toBeGreaterThan(0);

    // ---- 4. marking: TAUGHT, PARTLY, NOT_TAUGHT, then an extra period
    const mark = (who: Who | 'ADMIN', date: string, status: LessonDeliveryStatus, extra = {}) =>
      as('put', '/lesson-deliveries', who).send({
        section_id: SEED_SECTION_1_ID,
        subject_id: subjectId,
        date,
        period_slot_id: periodId,
        status,
        ...extra,
      });
    await mark('T', mondayBack(0), LessonDeliveryStatus.TAUGHT).expect(200);
    // ADMIN may edit past the teacher window.
    await mark('ADMIN', mondayBack(1), LessonDeliveryStatus.PARTLY).expect(200);
    await mark('ADMIN', mondayBack(2), LessonDeliveryStatus.NOT_TAUGHT, {
      reason: LessonDeliveryReason.CANCELLED,
    }).expect(200);
    await as('post', '/lesson-deliveries/extra', 'T')
      .send({
        section_id: SEED_SECTION_1_ID,
        subject_id: subjectId,
        date: mondayBack(0),
        period_slot_id: freePeriodId,
      })
      .expect(201);

    // ---- 5. behind moved: marking cleared owed periods
    const after = await as('get', `/study-plans/${planId}/schedule`, 'T').expect(200);
    expect(after.body.summary.periods_behind).toBeLessThan(before.body.summary.periods_behind);
    expect(after.body.summary.lessons_done).toBeGreaterThanOrEqual(1);

    // ---- 6. admin list + progress.csv agree with the schedule
    const list = await as('get', '/study-plans?behind=true', 'ADMIN').expect(200);
    const row = list.body.data.find((r: { id: string }) => r.id === planId);
    expect(row.summary.periods_behind).toBe(after.body.summary.periods_behind);
    const progress = await as(
      'get',
      `/study-plans/progress.csv?class_id=${SEED_CLASS_1_ID}&academic_term_id=${termId}`,
      'ADMIN',
    ).expect(200);
    expect(progress.headers['content-type']).toContain('text/csv');

    // ---- 7. family view equals the staff schedule
    const fam = await as('get', `/students/${studentId}/study-plans`, 'PARENT').expect(200);
    const block = fam.body.subjects.find((s: { plan_id: string }) => s.plan_id === planId);
    expect(block.periods_behind).toBe(after.body.summary.periods_behind);
    expect(block.lessons_done).toBe(after.body.summary.lessons_done);
    expect(block.lessons_total).toBe(12);
    await as('get', `/students/${studentId}/lessons?date=${mondayBack(0)}`, 'PARENT').expect(200);

    // ---- 8. CSV round trip leaves the lessons unchanged
    const beforeCsv = await as('get', `/study-plans/${planId}`, 'T').expect(200);
    const csv = await as('get', `/study-plans/${planId}/lessons.csv`, 'T').expect(200);
    const v = await as('post', '/study-plans/import/validate', 'T')
      .attach('file', Buffer.from(csv.text, 'utf-8'), {
        filename: 'lessons.csv',
        contentType: 'text/csv',
      })
      .field('class_id', SEED_CLASS_1_ID)
      .field('subject_id', subjectId)
      .expect(201);
    expect(v.body.hard_error_count).toBe(0);
    const commit = await as('post', '/study-plans/import/commit', 'T')
      .send({ staging_id: v.body.staging_id, plan_id: planId })
      .expect(201);
    const pick = (ls: { title: string; periods: number }[]) => ls.map((l) => [l.title, l.periods]);
    expect(pick(commit.body.lessons)).toEqual(pick(beforeCsv.body.lessons));

    // ---- 9. fences
    await mark('U', mondayBack(0), LessonDeliveryStatus.TAUGHT).expect(403);
    // Unlinked family callers get 401 today (FamilyAccessService), not 403.
    await as('get', `/students/${studentId}/study-plans`, 'PARENT_OTHER').expect(401);
    const t2 = await as('get', '/study-plans', 'ADMIN2', TENANT_2).expect(200);
    expect(t2.body.data).toEqual([]);
    await as('get', `/study-plans/${planId}`, 'ADMIN2', TENANT_2).expect(404);
  }, 120000);
});
