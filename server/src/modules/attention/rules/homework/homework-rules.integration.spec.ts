import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { DataSource } from 'typeorm';
import Redis from 'ioredis';
import { UserRole } from '@biddaloy/shared';
import { ALL_ENTITIES } from '@test/all-entities';
import { createTestModule } from '@test/helpers/module.helper';
import { TENANT_STATUS_REDIS } from '../../../schools/tenant-status.service';
import { SchoolCalendarService } from '../../../calendar/school-calendar.service';
import { ResolveRoutineService } from '../../../routines/resolve-routine.service';
import { FamilyAccessService } from '../../../students/family-access.service';
import { AlertWriterService } from '../../engine/alert-writer.service';
import type { RuleContext } from '../rule.types';
import { HomeworkNotSubmittedRule } from './homework-not-submitted.rule';

// A Monday inside both tenants' 2043 academic year.
const DAY = '2043-03-02';

describe('Homework rules (integration)', () => {
  let ds: DataSource;
  let redis: Redis;
  let writer: AlertWriterService;
  let rule: HomeworkNotSubmittedRule;

  interface Tenant {
    id: string;
    sectionId: string;
    subjectId: string;
    homeworkId: string;
    assignmentId: string;
    teacherUserId: string;
    /** [no-submission student with login+parent, no-submission student with parent, submitted student] */
    students: string[];
    parentUsers: string[];
    studentUser: string;
  }
  let A: Tenant;
  let B: Tenant;

  const rand = () => Math.random().toString(36).slice(2, 9);
  const ctx = (t: Tenant, localTime: string): RuleContext => ({
    tenantId: t.id,
    now: new Date(`${DAY}T04:00:00Z`),
    tz: 'Asia/Dhaka',
    localDate: DAY,
    localTime,
    isWorkingDay: true,
    settings: {} as RuleContext['settings'],
  });
  const q = async (sql: string, params: unknown[] = []) => ds.query(sql, params);
  const mkUser = async (name: string, tenantId: string, role: string) => {
    const [{ id }] = await q(
      `INSERT INTO users (email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, 'x', $2, 'ACTIVE', NOW(), NOW()) RETURNING id`,
      [`hw-${rand()}@example.com`, name],
    );
    await q(`INSERT INTO user_tenants (user_id, tenant_id, role) VALUES ($1, $2, $3)`, [
      id,
      tenantId,
      role,
    ]);
    return id as string;
  };

  async function mkTenant(): Promise<Tenant> {
    const [{ id }] = await q(
      `INSERT INTO schools (name, slug) VALUES ('Homework Test', $1) RETURNING id`,
      [`hw-${rand()}`],
    );
    const [{ id: yearId }] = await q(
      `INSERT INTO academic_years (name, start_date, end_date, is_current, tenant_id)
       VALUES ('2043', '2043-01-01', '2043-12-31', true, $1) RETURNING id`,
      [id],
    );
    const [{ id: classId }] = await q(
      `INSERT INTO classes (name, academic_year_id, tenant_id) VALUES ('Seven', $1, $2) RETURNING id`,
      [yearId, id],
    );
    const [{ id: sectionId }] = await q(
      `INSERT INTO class_sections (class_id, section_name, tenant_id) VALUES ($1, 'B', $2) RETURNING id`,
      [classId, id],
    );
    const studentUser = await mkUser('Kid One', id, 'STUDENT');
    const students: string[] = [];
    const parentUsers: string[] = [];
    for (let i = 0; i < 3; i++) {
      const [{ id: sid }] = await q(
        `INSERT INTO students (full_name, registration_number, roll_number, class_section_id, tenant_id, enrollment_status, user_id)
         VALUES ($1, $2, $3, $4, $5, 'ACTIVE', $6) RETURNING id`,
        [`Kid ${i + 1}`, `HW-${rand()}`, i + 1, sectionId, id, i === 0 ? studentUser : null],
      );
      students.push(sid);
      if (i < 2) {
        const parentUser = await mkUser(`Parent ${i + 1}`, id, 'PARENT');
        parentUsers.push(parentUser);
        const [{ id: gid }] = await q(
          `INSERT INTO guardians (full_name, relationship, phone, tenant_id, user_id)
           VALUES ('Parent', 'Father', '01700000000', $1, $2) RETURNING id`,
          [id, parentUser],
        );
        await q(`INSERT INTO student_guardians (student_id, guardian_id) VALUES ($1, $2)`, [
          sid,
          gid,
        ]);
      }
    }
    const teacherUserId = await mkUser('Math Teacher', id, 'TEACHER');
    return {
      id,
      sectionId,
      subjectId: '',
      homeworkId: '',
      assignmentId: '',
      teacherUserId,
      students,
      parentUsers,
      studentUser,
      ...{ classId },
    } as Tenant;
  }

  async function mkKit(t: Tenant) {
    const { classId } = t as unknown as { classId: string };
    // Teachers are wiped between tests too.
    const [{ id: sp }] = await q(
      `INSERT INTO staff_profiles (id, user_id, tenant_id, employee_id, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, NOW(), NOW())
       ON CONFLICT (user_id) DO UPDATE SET updated_at = NOW() RETURNING id`,
      [t.teacherUserId, t.id, `SP-${rand()}`],
    );
    const [{ id: teacherId }] = await q(
      `INSERT INTO teachers (id, user_id, employee_id, designations, tenant_id, staff_profile_id, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, '{}', $3, $4, NOW(), NOW()) RETURNING id`,
      [t.teacherUserId, `T-${rand()}`, t.id, sp],
    );
    const [{ id: subjectId }] = await q(
      `INSERT INTO subjects (tenant_id, name_en, name_bn, code) VALUES ($1, 'Math', 'গণিত', $2) RETURNING id`,
      [t.id, `M-${rand()}`],
    );
    t.subjectId = subjectId;
    await q(
      `INSERT INTO teacher_class_sections (teacher_id, section_id, subject_id, assignment_type, tenant_id)
       VALUES ($1, $2, $3, 'SUBJECT_TEACHER', $4)`,
      [teacherId, t.sectionId, subjectId, t.id],
    );
    const [{ id: yearId }] = await q(`SELECT id FROM academic_years WHERE tenant_id = $1`, [t.id]);
    const [{ id: routineId }] = await q(
      `INSERT INTO routines (tenant_id, academic_year_id, name, state, published_at)
       VALUES ($1, $2, 'R', 'PUBLISHED', NOW()) RETURNING id`,
      [t.id, yearId],
    );
    const [{ id: shiftId }] = await q(
      `INSERT INTO shifts (tenant_id, name, day_starts_at, day_ends_at, sequence)
       VALUES ($1, $2, '08:00', '14:00', 0) RETURNING id`,
      [t.id, `S-${rand()}`],
    );
    const [{ id: p1 }] = await q(
      `INSERT INTO period_slots (tenant_id, shift_id, sequence, kind, starts_at, ends_at)
       VALUES ($1, $2, 0, 'CLASS', '09:00', '09:40') RETURNING id`,
      [t.id, shiftId],
    );
    const [{ id: p2 }] = await q(
      `INSERT INTO period_slots (tenant_id, shift_id, sequence, kind, starts_at, ends_at)
       VALUES ($1, $2, 1, 'CLASS', '10:00', '10:40') RETURNING id`,
      [t.id, shiftId],
    );
    void p1;
    await q(
      `INSERT INTO routine_slots (tenant_id, routine_id, section_id, period_slot_id, weekday, subject_id,
         recurrence, recurrence_offset, valid_from)
       VALUES ($1, $2, $3, $4, 1, $5, 'WEEKLY', 0, '2043-01-01')`,
      [t.id, routineId, t.sectionId, p2, subjectId],
    );
    const [{ id: homeworkId }] = await q(
      `INSERT INTO homework (title, subject_id, class_id, grading_mode, attachments, tenant_id)
       VALUES ('Chapter 3', $1, $2, 'TICK', '[]', $3) RETURNING id`,
      [subjectId, classId, t.id],
    );
    t.homeworkId = homeworkId;
    const [{ id: assignmentId }] = await q(
      `INSERT INTO homework_assignments (homework_id, section_id, assigned_date, due_date, status, tenant_id)
       VALUES ($1, $2, $3, $3, 'ACTIVE', $4) RETURNING id`,
      [homeworkId, t.sectionId, DAY, t.id],
    );
    t.assignmentId = assignmentId;
    // Student 3 already handed it in.
    await submit(t, t.students[2]);
  }

  const submit = (t: Tenant, studentId: string) =>
    q(
      `INSERT INTO homework_submissions (assignment_id, student_id, status, attachments, tenant_id)
       VALUES ($1, $2, 'SUBMITTED', '[]', $3)`,
      [t.assignmentId, studentId, t.id],
    );

  beforeAll(async () => {
    redis = new Redis(process.env.REDIS_URL!);
    const module = await createTestModule(
      ALL_ENTITIES,
      [
        AlertWriterService,
        { provide: TENANT_STATUS_REDIS, useValue: redis },
        // Real resolver and family query; only the school calendar is stubbed (every day works).
        ResolveRoutineService,
        FamilyAccessService,
        {
          provide: SchoolCalendarService,
          useValue: { getWorkingDays: async () => ({ dates: [DAY] }) },
        },
        HomeworkNotSubmittedRule,
      ],
      [],
    );
    ds = module.get(DataSource);
    writer = module.get(AlertWriterService);
    rule = module.get(HomeworkNotSubmittedRule);
  }, 60000);

  afterAll(async () => {
    redis.disconnect();
    await ds.destroy();
  });

  // The suite resets most tables between tests, so each test gets two fresh tenants.
  beforeEach(async () => {
    A = await mkTenant();
    B = await mkTenant();
    for (const t of [A, B]) await mkKit(t);
  });

  it('fires at the Math period start: 2 students + their families, 1 teacher item (count 2)', async () => {
    const findings = await rule.evaluate(ctx(A, '10:00'));
    const studentFindings = findings.filter((f) => f.subject?.type === 'student');
    expect(studentFindings.map((f) => f.subject!.id).sort()).toEqual(
      [A.students[0], A.students[1]].sort(),
    );
    // Kid 1: parent + the student's own login; Kid 2: parent only.
    const byStudent = (id: string) =>
      studentFindings
        .find((f) => f.subject!.id === id)!
        .recipients.map((r) => r.userId)
        .sort();
    expect(byStudent(A.students[0])).toEqual([A.parentUsers[0], A.studentUser].sort());
    expect(byStudent(A.students[1])).toEqual([A.parentUsers[1]]);
    const [teacher] = findings.filter((f) => f.subject?.type === 'section');
    expect(teacher.params.count).toBe(2);
    expect(teacher.recipients).toEqual([{ userId: A.teacherUserId, role: UserRole.TEACHER }]);
  });

  it('does not fire before period 2, or for a deactivated assignment', async () => {
    expect(await rule.evaluate(ctx(A, '09:59'))).toEqual([]);
    await q(`UPDATE homework_assignments SET status = 'DEACTIVATED' WHERE tenant_id = $1`, [A.id]);
    expect(await rule.evaluate(ctx(A, '10:30'))).toEqual([]);
  });

  it("tenant isolation: B's people never appear in A's findings", async () => {
    const aUsers = (await rule.evaluate(ctx(A, '10:00'))).flatMap((f) =>
      f.recipients.map((r) => r.userId),
    );
    const bUsers = [...B.parentUsers, B.studentUser, B.teacherUserId];
    expect(aUsers.some((u) => bUsers.includes(u))).toBe(false);
    const bFindings = await rule.evaluate(ctx(B, '10:00'));
    expect(bFindings.filter((f) => f.subject?.type === 'section')[0].params.count).toBe(2);
  });

  it('resolves: a student submits, their alert RESOLVES and the teacher count drops to 1', async () => {
    const c = ctx(A, '10:00');
    await writer.apply(c, rule, await rule.evaluate(c));
    const active = () =>
      q(`SELECT dedupe_key, status, params FROM alerts WHERE tenant_id = $1 AND rule_key = $2`, [
        A.id,
        'homework.not_submitted',
      ]);
    expect((await active()).filter((a: any) => a.status === 'ACTIVE')).toHaveLength(3);

    await submit(A, A.students[0]);
    await writer.apply(c, rule, await rule.evaluate(c));
    const after = await active();
    expect(after.find((a: any) => a.dedupe_key.startsWith(`student:${A.students[0]}`)).status).toBe(
      'RESOLVED',
    );
    expect(after.find((a: any) => a.dedupe_key.startsWith('section:')).params.count).toBe(1);
  });
});
