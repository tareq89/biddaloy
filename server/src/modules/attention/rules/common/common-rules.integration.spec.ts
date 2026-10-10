import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { DataSource } from 'typeorm';
import Redis from 'ioredis';
import { UserRole } from '@biddaloy/shared';
import { ALL_ENTITIES } from '@test/all-entities';
import { createTestModule } from '@test/helpers/module.helper';
import { TENANT_STATUS_REDIS } from '../../../schools/tenant-status.service';
import { FamilyAccessService } from '../../../students/family-access.service';
import { AlertWriterService } from '../../engine/alert-writer.service';
import type { RuleContext } from '../rule.types';
import { CalendarHolidayTomorrowRule } from './calendar-holiday-tomorrow.rule';
import { SurveysPendingRule } from './surveys-pending.rule';

const DAY = '2043-03-20';
const TOMORROW = '2043-03-21';

describe('Common rules (integration)', () => {
  let ds: DataSource;
  let redis: Redis;
  let writer: AlertWriterService;
  let holiday: CalendarHolidayTomorrowRule;
  let surveys: SurveysPendingRule;

  interface Tenant {
    id: string;
    yearId: string;
    classId: string;
    userOf: Record<string, string>; // ADMIN, TEACHER, ACCOUNTANT, SUPER, PARENT, STUDENT
    surveyId: string; // OPEN, GUARDIANS, targets the teacher's Math
    teacherId: string;
    subjectId: string;
  }
  let A: Tenant;
  let B: Tenant;

  const rand = () => Math.random().toString(36).slice(2, 9);
  const q = (sql: string, params: unknown[] = []) => ds.query(sql, params);
  const ctx = (t: Tenant): RuleContext => ({
    tenantId: t.id,
    now: new Date(`${DAY}T14:00:00Z`),
    tz: 'Asia/Dhaka',
    localDate: DAY,
    localTime: '20:00',
    isWorkingDay: true,
    settings: {} as RuleContext['settings'],
  });

  async function mkUser(tenantId: string, role: string) {
    const [{ id }] = await q(
      `INSERT INTO users (email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, 'x', 'Common Test', 'ACTIVE', NOW(), NOW()) RETURNING id`,
      [`common-${rand()}@example.com`],
    );
    await q(`INSERT INTO user_tenants (user_id, tenant_id, role) VALUES ($1, $2, $3)`, [
      id,
      tenantId,
      role,
    ]);
    return id as string;
  }

  async function mkHoliday(
    t: Tenant,
    over: { audience?: string; date?: string; published?: boolean } = {},
  ) {
    const date = over.date ?? TOMORROW;
    const [{ id }] = await q(
      `INSERT INTO calendar_events (tenant_id, academic_year_id, type, start_date, end_date, name,
         counts_as_working_day, audience, published_at)
       VALUES ($1, $2, 'HOLIDAY', $3, $3, 'Eid', false, $4, ${over.published === false ? 'NULL' : 'NOW()'})
       RETURNING id`,
      [t.id, t.yearId, date, over.audience ?? 'ALL'],
    );
    return id as string;
  }

  async function mkTenant(): Promise<Tenant> {
    const [{ id }] = await q(
      `INSERT INTO schools (name, slug) VALUES ('Common Test', $1) RETURNING id`,
      [`common-${rand()}`],
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
      `INSERT INTO class_sections (class_id, section_name, tenant_id) VALUES ($1, 'A', $2) RETURNING id`,
      [classId, id],
    );
    const userOf: Record<string, string> = {
      ADMIN: await mkUser(id, 'ADMIN'),
      TEACHER: await mkUser(id, 'TEACHER'),
      ACCOUNTANT: await mkUser(id, 'ACCOUNTANT'),
      SUPER: await mkUser(id, 'SUPER_ADMIN'),
      PARENT: await mkUser(id, 'PARENT'),
      STUDENT: await mkUser(id, 'STUDENT'),
    };
    const [{ id: gid }] = await q(
      `INSERT INTO guardians (full_name, relationship, phone, tenant_id, user_id)
       VALUES ('Parent', 'Father', '01700000000', $1, $2) RETURNING id`,
      [id, userOf.PARENT],
    );
    // Two children in the same section: the parent must still see the pair once.
    for (const [i, withStudentUser] of [true, false].entries()) {
      const [{ id: sid }] = await q(
        `INSERT INTO students (full_name, registration_number, roll_number, class_section_id, tenant_id, enrollment_status, user_id)
         VALUES ($1, $2, $3, $4, $5, 'ACTIVE', $6) RETURNING id`,
        [`Kid ${i}`, `C-${rand()}`, i + 1, sectionId, id, withStudentUser ? userOf.STUDENT : null],
      );
      await q(`INSERT INTO student_guardians (student_id, guardian_id) VALUES ($1, $2)`, [
        sid,
        gid,
      ]);
    }
    const [{ id: sp }] = await q(
      `INSERT INTO staff_profiles (id, user_id, tenant_id, employee_id, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, NOW(), NOW()) RETURNING id`,
      [userOf.TEACHER, id, `SP-${rand()}`],
    );
    const [{ id: teacherId }] = await q(
      `INSERT INTO teachers (id, user_id, employee_id, designations, tenant_id, staff_profile_id, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, '{}', $3, $4, NOW(), NOW()) RETURNING id`,
      [userOf.TEACHER, `T-${rand()}`, id, sp],
    );
    const [{ id: subjectId }] = await q(
      `INSERT INTO subjects (tenant_id, name_en, name_bn, code) VALUES ($1, 'Math', 'গণিত', $2) RETURNING id`,
      [id, `M-${rand()}`],
    );
    await q(
      `INSERT INTO teacher_class_sections (teacher_id, section_id, subject_id, assignment_type, tenant_id)
       VALUES ($1, $2, $3, 'SUBJECT_TEACHER', $4)`,
      [teacherId, sectionId, subjectId, id],
    );
    const [{ id: surveyId }] = await q(
      `INSERT INTO surveys (tenant_id, title, status, respondent) VALUES ($1, 'Teachers', 'OPEN', 'GUARDIANS') RETURNING id`,
      [id],
    );
    await q(
      `INSERT INTO survey_targets (tenant_id, survey_id, teacher_id, subject_id) VALUES ($1, $2, $3, $4)`,
      [id, surveyId, teacherId, subjectId],
    );
    return { id, yearId, classId, userOf, surveyId, teacherId, subjectId };
  }

  beforeAll(async () => {
    redis = new Redis(process.env.REDIS_URL!);
    const module = await createTestModule(
      ALL_ENTITIES,
      [
        AlertWriterService,
        { provide: TENANT_STATUS_REDIS, useValue: redis },
        FamilyAccessService,
        CalendarHolidayTomorrowRule,
        SurveysPendingRule,
      ],
      [],
    );
    ds = module.get(DataSource);
    writer = module.get(AlertWriterService);
    holiday = module.get(CalendarHolidayTomorrowRule);
    surveys = module.get(SurveysPendingRule);
  }, 60000);

  afterAll(async () => {
    redis.disconnect();
    await ds.destroy();
  });

  beforeEach(async () => {
    A = await mkTenant();
    B = await mkTenant();
  });

  it('fires: holiday for staff and for the family; survey for the guardian with count 1', async () => {
    await mkHoliday(A);
    const found = await holiday.evaluate(ctx(A));
    const staff = found.find((f) => f.dedupeKey.endsWith(':staff'))!;
    const family = found.find((f) => f.dedupeKey.endsWith(':family'))!;
    const ids = (f: typeof staff) => f.recipients.map((r) => r.userId).sort();
    expect(ids(staff)).toEqual([A.userOf.ADMIN, A.userOf.TEACHER, A.userOf.ACCOUNTANT].sort());
    expect(ids(family)).toEqual([A.userOf.PARENT, A.userOf.STUDENT].sort());

    const [s] = await surveys.evaluate(ctx(A));
    expect(s.recipients).toEqual([{ userId: A.userOf.PARENT, role: UserRole.PARENT }]);
    // Two children in one section share the same (teacher, subject) pair: counted once.
    expect(s.params).toMatchObject({ title: 'Teachers', count: 1 });
  });

  it('does not fire: unpublished, class-scoped, day-after-tomorrow; STAFF holidays skip families', async () => {
    await mkHoliday(A, { published: false });
    await mkHoliday(A, { date: '2043-03-22' });
    const scoped = await mkHoliday(A);
    await q(
      `INSERT INTO calendar_event_classes (event_id, class_id, tenant_id) VALUES ($1, $2, $3)`,
      [scoped, A.classId, A.id],
    );
    expect(await holiday.evaluate(ctx(A))).toEqual([]);

    await mkHoliday(A, { audience: 'STAFF' });
    const found = await holiday.evaluate(ctx(A));
    expect(found.map((f) => f.dedupeKey.split(':').pop())).toEqual(['staff']);
  });

  it('does not fire: answered survey; closed survey', async () => {
    await q(
      `INSERT INTO survey_responses (tenant_id, survey_id, respondent_user_id, teacher_id, subject_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [A.id, A.surveyId, A.userOf.PARENT, A.teacherId, A.subjectId],
    );
    expect(await surveys.evaluate(ctx(A))).toEqual([]);

    await q(`DELETE FROM survey_responses WHERE tenant_id = $1`, [A.id]);
    expect(await surveys.evaluate(ctx(A))).toHaveLength(1);
    await q(`UPDATE surveys SET status = 'CLOSED' WHERE id = $1`, [A.surveyId]);
    expect(await surveys.evaluate(ctx(A))).toEqual([]);
  });

  it("tenant isolation: B's holiday and survey never reach A; SUPER_ADMIN gets nothing", async () => {
    await mkHoliday(B);
    // A has no holiday of its own; B's must not show up for A.
    expect(await holiday.evaluate(ctx(A))).toEqual([]);

    await mkHoliday(A);
    const everyone = [
      ...(await holiday.evaluate(ctx(A))),
      ...(await surveys.evaluate(ctx(A))),
    ].flatMap((f) => f.recipients.map((r) => r.userId));
    expect(everyone.some((u) => Object.values(B.userOf).includes(u))).toBe(false);
    expect(everyone).not.toContain(A.userOf.SUPER);
  });

  it('resolves: the guardian answering the survey clears the alert', async () => {
    const c = ctx(A);
    await writer.apply(c, surveys, await surveys.evaluate(c));
    const status = async () =>
      (
        await q(`SELECT status FROM alerts WHERE tenant_id = $1 AND rule_key = 'surveys.pending'`, [
          A.id,
        ])
      )[0].status;
    expect(await status()).toBe('ACTIVE');

    await q(
      `INSERT INTO survey_responses (tenant_id, survey_id, respondent_user_id, teacher_id, subject_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [A.id, A.surveyId, A.userOf.PARENT, A.teacherId, A.subjectId],
    );
    await writer.apply(c, surveys, await surveys.evaluate(c));
    expect(await status()).toBe('RESOLVED');
  });
});
