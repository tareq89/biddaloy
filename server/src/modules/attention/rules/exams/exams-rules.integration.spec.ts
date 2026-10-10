import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { DataSource } from 'typeorm';
import Redis from 'ioredis';
import { UserRole } from '@biddaloy/shared';
import { ALL_ENTITIES } from '@test/all-entities';
import { createTestModule } from '@test/helpers/module.helper';
import { TENANT_STATUS_REDIS } from '../../../schools/tenant-status.service';
import { AlertWriterService } from '../../engine/alert-writer.service';
import { ATTENTION_RECHECK } from '../../engine/attention-events';
import { attentionEvents } from '../../attention.constants';
import { ResultsService } from '../../../exams/results.service';
import { MarkGridService } from '../../../exams/mark-grid.service';
import { AttendanceComponentService } from '../../../exams/attendance-component.service';
import { MarksAuthorizationService } from '../../../exams/marks-authorization.util';
import { AuditService } from '../../../audit/audit.service';
import type { RuleContext } from '../rule.types';
import { ExamsMarksOverdueRule } from './exams-marks-overdue.rule';
import { ExamsMyMarksDueRule } from './exams-my-marks-due.rule';
import { ExamsResultsUnpublishedRule } from './exams-results-unpublished.rule';
import { ExamsScheduleUnpublishedRule } from './exams-schedule-unpublished.rule';
import { ExamsSeatPlanMissingRule } from './exams-seat-plan-missing.rule';

const DAY = '2043-03-20';
const day = (n: number) => new Date(Date.parse(DAY) + n * 86_400_000).toISOString().slice(0, 10);

describe('Exams rules (integration)', () => {
  let ds: DataSource;
  let redis: Redis;
  let writer: AlertWriterService;
  let marksOverdue: ExamsMarksOverdueRule;
  let myMarks: ExamsMyMarksDueRule;
  let unpublished: ExamsResultsUnpublishedRule;
  let schedule: ExamsScheduleUnpublishedRule;
  let seatPlan: ExamsSeatPlanMissingRule;
  let results: ResultsService;

  interface Tenant {
    id: string;
    yearId: string;
    classId: string;
    sections: string[]; // S1, S2
    math: string;
    english: string;
    userOf: Record<string, string>; // EXEC, CTRL, MATH1 (Math teacher of S1), ENG1 (English teacher of S1)
    exam: string; // DRAFT, ended 10 days ago, Math + English components
  }
  let A: Tenant;
  let B: Tenant;

  const rand = () => Math.random().toString(36).slice(2, 9);
  const q = (sql: string, params: unknown[] = []) => ds.query(sql, params);
  const ctx = (t: Tenant): RuleContext => ({
    tenantId: t.id,
    now: new Date(`${DAY}T04:00:00Z`),
    tz: 'Asia/Dhaka',
    localDate: DAY,
    localTime: '10:00',
    isWorkingDay: true,
    settings: {} as RuleContext['settings'],
  });

  async function mkUser(tenantId: string, role: string) {
    const [{ id }] = await q(
      `INSERT INTO users (email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, 'x', 'Exam Test', 'ACTIVE', NOW(), NOW()) RETURNING id`,
      [`exam-${rand()}@example.com`],
    );
    await q(`INSERT INTO user_tenants (user_id, tenant_id, role) VALUES ($1, $2, $3)`, [
      id,
      tenantId,
      role,
    ]);
    return id as string;
  }

  async function mkTeacher(tenantId: string, sectionId: string, subjectId: string) {
    const userId = await mkUser(tenantId, 'TEACHER');
    const [{ id: sp }] = await q(
      `INSERT INTO staff_profiles (id, user_id, tenant_id, employee_id, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, NOW(), NOW()) RETURNING id`,
      [userId, tenantId, `SP-${rand()}`],
    );
    const [{ id: teacherId }] = await q(
      `INSERT INTO teachers (id, user_id, employee_id, designations, tenant_id, staff_profile_id, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, '{}', $3, $4, NOW(), NOW()) RETURNING id`,
      [userId, `T-${rand()}`, tenantId, sp],
    );
    await q(
      `INSERT INTO teacher_class_sections (teacher_id, section_id, tenant_id, subject_id, assignment_type)
       VALUES ($1, $2, $3, $4, 'SUBJECT_TEACHER')`,
      [teacherId, sectionId, tenantId, subjectId],
    );
    return userId;
  }

  async function mkExam(
    t: Pick<Tenant, 'id' | 'yearId' | 'classId'>,
    name: string,
    status: string,
    subjectIds: string[],
  ) {
    const [{ id }] = await q(
      `INSERT INTO exams (tenant_id, academic_year_id, class_id, name, kind, status)
       VALUES ($1, $2, $3, $4, 'TERM', $5) RETURNING id`,
      [t.id, t.yearId, t.classId, name, status],
    );
    let seq = 0;
    for (const s of subjectIds) {
      await q(
        `INSERT INTO exam_components (tenant_id, exam_id, subject_id, name, kind, full_marks, sequence)
         VALUES ($1, $2, $3, 'Written', 'WRITTEN', 100, $4)`,
        [t.id, id, s, seq++],
      );
    }
    return id as string;
  }

  const sit = async (tenantId: string, examId: string, subjectId: string, date: string) => {
    const [{ id }] = await q(
      `INSERT INTO exam_schedules (tenant_id, exam_id, subject_id, date, starts_at, ends_at)
       VALUES ($1, $2, $3, $4, '10:00', '12:00') RETURNING id`,
      [tenantId, examId, subjectId, date],
    );
    return id as string;
  };

  async function mkTenant(): Promise<Tenant> {
    const [{ id }] = await q(
      `INSERT INTO schools (name, slug) VALUES ('Exam Test', $1) RETURNING id`,
      [`exam-${rand()}`],
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
    const sections: string[] = [];
    for (const name of ['A', 'B']) {
      const [{ id: s }] = await q(
        `INSERT INTO class_sections (class_id, section_name, tenant_id) VALUES ($1, $2, $3) RETURNING id`,
        [classId, name, id],
      );
      sections.push(s);
    }
    const subj = async (en: string) =>
      (
        await q(
          `INSERT INTO subjects (tenant_id, name_en, name_bn, code) VALUES ($1, $2, $2, $3) RETURNING id`,
          [id, en, `${en}-${rand()}`],
        )
      )[0].id as string;
    const math = await subj('Math');
    const english = await subj('English');
    const exam = await mkExam({ id, yearId, classId }, 'Term 1', 'DRAFT', [math, english]);
    await sit(id, exam, math, day(-10));
    await sit(id, exam, english, day(-10));
    return {
      id,
      yearId,
      classId,
      sections,
      math,
      english,
      exam,
      userOf: {
        EXEC: await mkUser(id, 'EXECUTIVE'),
        CTRL: await mkUser(id, 'EXAM_CONTROLLER'),
        MATH1: await mkTeacher(id, sections[0], math),
        ENG1: await mkTeacher(id, sections[0], english),
      },
    };
  }

  beforeAll(async () => {
    redis = new Redis(process.env.REDIS_URL!);
    const module = await createTestModule(
      ALL_ENTITIES,
      [
        AlertWriterService,
        { provide: TENANT_STATUS_REDIS, useValue: redis },
        ExamsMarksOverdueRule,
        ExamsMyMarksDueRule,
        ExamsResultsUnpublishedRule,
        ExamsScheduleUnpublishedRule,
        ExamsSeatPlanMissingRule,
        ResultsService,
        MarkGridService,
        { provide: AttendanceComponentService, useValue: {} },
        { provide: AuditService, useValue: { record: async () => undefined } },
        { provide: MarksAuthorizationService, useValue: {} },
      ],
      [],
    );
    ds = module.get(DataSource);
    writer = module.get(AlertWriterService);
    marksOverdue = module.get(ExamsMarksOverdueRule);
    myMarks = module.get(ExamsMyMarksDueRule);
    unpublished = module.get(ExamsResultsUnpublishedRule);
    schedule = module.get(ExamsScheduleUnpublishedRule);
    seatPlan = module.get(ExamsSeatPlanMissingRule);
    results = module.get(ResultsService);
  }, 60000);

  afterAll(async () => {
    redis.disconnect();
    await ds.destroy();
  });

  beforeEach(async () => {
    A = await mkTenant();
    B = await mkTenant();
  });

  it('fires: no grids is 4 open sheets for EXECUTIVE + EXAM_CONTROLLER; the Math teacher of S1 is told', async () => {
    const [f] = await marksOverdue.evaluate(ctx(A));
    expect(f.params).toMatchObject({ outstanding: 4, days: 10 });
    expect(f.recipients.map((r) => r.userId).sort()).toEqual([A.userOf.EXEC, A.userOf.CTRL].sort());

    const mine = await myMarks.evaluate(ctx(A));
    const math = mine.find((m) => m.recipients[0].userId === A.userOf.MATH1)!;
    expect(math.params).toMatchObject({ count: 1, sectionLabel: 'Seven-A' });
    expect(math.recipients[0].role).toBe(UserRole.TEACHER);
    // S2 has no subject teachers, so only the two S1 teachers hear about their sheets.
    expect(mine).toHaveLength(2);
  });

  it('fires: PROCESSED exam, schedule with a missing subject, sitting tomorrow without a seat plan', async () => {
    const processed = await mkExam(A, 'Final', 'PROCESSED', [A.math]);
    const [u] = await unpublished.evaluate(ctx(A));
    expect(u.dedupeKey).toBe(`exam:${processed}`);

    const soon = await mkExam(A, 'Soon', 'DRAFT', [A.math, A.english]);
    await sit(A.id, soon, A.math, day(1)); // English has no sitting yet
    const [s] = await schedule.evaluate(ctx(A));
    expect(s.params).toMatchObject({ unscheduled: 1, firstDate: day(1) });
    const [p] = await seatPlan.evaluate(ctx(A));
    expect(p.params).toMatchObject({ sittings: 1, firstDate: day(1) });
  });

  it('does not fire: all grids SUBMITTED; a PUBLISHED seat plan covers the sitting', async () => {
    for (const section of A.sections) {
      for (const subject of [A.math, A.english]) {
        await q(
          `INSERT INTO mark_grids (tenant_id, exam_id, section_id, subject_id, state) VALUES ($1, $2, $3, $4, 'SUBMITTED')`,
          [A.id, A.exam, section, subject],
        );
      }
    }
    expect(await marksOverdue.evaluate(ctx(A))).toEqual([]);
    expect(await myMarks.evaluate(ctx(A))).toEqual([]);

    const next = await mkExam(A, 'Next', 'DRAFT', [A.math]);
    const sitting = await sit(A.id, next, A.math, day(1));
    expect(await seatPlan.evaluate(ctx(A))).toHaveLength(1);
    const [{ id: plan }] = await q(
      `INSERT INTO seat_plans (tenant_id, name, status, seat_order_mode) VALUES ($1, 'P', 'PUBLISHED', 'SEQUENTIAL') RETURNING id`,
      [A.id],
    );
    await q(
      `INSERT INTO seat_plan_schedules (tenant_id, seat_plan_id, exam_schedule_id) VALUES ($1, $2, $3)`,
      [A.id, plan, sitting],
    );
    expect(await seatPlan.evaluate(ctx(A))).toEqual([]);
  });

  it("tenant isolation: B's grids and exams never count for A; B's users are never recipients", async () => {
    await mkExam(B, 'B final', 'PROCESSED', [B.math]);
    const found = [
      ...(await marksOverdue.evaluate(ctx(A))),
      ...(await myMarks.evaluate(ctx(A))),
      ...(await unpublished.evaluate(ctx(A))),
    ];
    // A has no PROCESSED exam, and A's single overdue exam counts only A's 4 sheets.
    expect(
      found.filter((f) => f.dedupeKey.startsWith('exam:') && f.params.exam === 'B final'),
    ).toEqual([]);
    expect(found.find((f) => f.params.outstanding)?.params.outstanding).toBe(4);
    const recipients = found.flatMap((f) => f.recipients.map((r) => r.userId));
    expect(recipients.some((u) => Object.values(B.userOf).includes(u))).toBe(false);
  });

  it('resolves: submitting the S1/Math sheet clears that teacher and drops the count to 3', async () => {
    const c = ctx(A);
    await writer.apply(c, myMarks, await myMarks.evaluate(c));
    await writer.apply(c, marksOverdue, await marksOverdue.evaluate(c));
    const status = (rule: string) =>
      q(`SELECT status, params FROM alerts WHERE tenant_id = $1 AND rule_key = $2`, [A.id, rule]);
    expect((await status('exams.my_marks_due')).map((r) => r.status)).toEqual(['ACTIVE', 'ACTIVE']);

    await q(
      `INSERT INTO mark_grids (tenant_id, exam_id, section_id, subject_id, state) VALUES ($1, $2, $3, $4, 'SUBMITTED')`,
      [A.id, A.exam, A.sections[0], A.math],
    );
    await writer.apply(c, myMarks, await myMarks.evaluate(c));
    await writer.apply(c, marksOverdue, await marksOverdue.evaluate(c));
    const mine = await q(
      `SELECT a.status FROM alerts a JOIN alert_recipients r ON r.alert_id = a.id
       WHERE a.tenant_id = $1 AND a.rule_key = 'exams.my_marks_due' AND r.user_id = $2`,
      [A.id, A.userOf.MATH1],
    );
    expect(mine[0].status).toBe('RESOLVED');
    expect((await marksOverdue.evaluate(c))[0].params.outstanding).toBe(3);
  });

  it('emit: publishing results rechecks results.published and exams.results_unpublished', async () => {
    const processed = await mkExam(A, 'Final', 'PROCESSED', [A.math]);
    const seen: { ruleKey: string; tenantId: string }[] = [];
    const listener = (p: { ruleKey: string; tenantId: string }) => seen.push(p);
    attentionEvents.on(ATTENTION_RECHECK, listener);
    try {
      await results.publish(processed, A.id, A.userOf.EXEC);
    } finally {
      attentionEvents.off(ATTENTION_RECHECK, listener);
    }
    expect(seen.map((s) => s.ruleKey).sort()).toEqual([
      'exams.results_unpublished',
      'results.published',
    ]);
    expect(seen.every((s) => s.tenantId === A.id)).toBe(true);
    expect(await unpublished.evaluate(ctx(A))).toEqual([]);
  });
});
