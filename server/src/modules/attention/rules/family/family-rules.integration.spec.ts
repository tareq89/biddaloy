import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { DataSource } from 'typeorm';
import Redis from 'ioredis';
import { PeriodSlotKind, SlotRecurrence, UserRole } from '@biddaloy/shared';
import { ALL_ENTITIES } from '@test/all-entities';
import { createTestModule } from '@test/helpers/module.helper';
import { TENANT_STATUS_REDIS } from '../../../schools/tenant-status.service';
import { SchoolCalendarService } from '../../../calendar/school-calendar.service';
import { ResolveRoutineService } from '../../../routines/resolve-routine.service';
import { SubstitutionsService } from '../../../routines/substitutions.service';
import { FamilyAccessService } from '../../../students/family-access.service';
import { attentionEvents } from '../../attention.constants';
import { ATTENTION_RECHECK, AttentionRecheckPayload } from '../../engine/attention-events';
import { AlertWriterService } from '../../engine/alert-writer.service';
import type { AttentionRule, RuleContext } from '../rule.types';
import { ChildAbsentTodayRule } from './child-absent-today.rule';
import { ExamsTomorrowRule } from './exams-tomorrow.rule';
import { FeesDueSoonRule } from './fees-due-soon.rule';
import { FeesOverdueFamilyRule } from './fees-overdue-family.rule';
import { GuardianProfileIncompleteRule } from './guardian-profile-incomplete.rule';
import { ResultsPublishedRule } from './results-published.rule';
import { RoutineChangedTodayRule } from './routine-changed-today.rule';

// A Monday inside both tenants' 2043 academic year; 10:00 in Dhaka.
const DAY = '2043-03-02';
const TOMORROW = '2043-03-03';
const NOW = new Date(`${DAY}T04:00:00Z`);
let roll = 0; // roll numbers are unique per section
const rand = () => Math.random().toString(36).slice(2, 9);

describe('Family rules (integration)', () => {
  let ds: DataSource;
  let redis: Redis;
  let writer: AlertWriterService;
  let substitutions: SubstitutionsService;
  let absent: ChildAbsentTodayRule;
  let dueSoon: FeesDueSoonRule;
  let overdue: FeesOverdueFamilyRule;
  let examsTomorrow: ExamsTomorrowRule;
  let resultsPublished: ResultsPublishedRule;
  let routineChanged: RoutineChangedTodayRule;
  let profile: GuardianProfileIncompleteRule;

  interface Tenant {
    id: string;
    yearId: string;
    classId: string;
    sectionId: string;
    c1: string; // child with a STUDENT login and a guardian with a PARENT login
    c2: string; // child whose guardian has no login
    parentUser: string;
    studentUser: string;
    guardianId: string; // g1's guardians row
    structureId: string;
  }
  let A: Tenant;
  let B: Tenant;

  const ctx = (t: Tenant): RuleContext => ({
    tenantId: t.id,
    now: NOW,
    tz: 'Asia/Dhaka',
    localDate: DAY,
    localTime: '10:00',
    isWorkingDay: true,
    settings: {} as RuleContext['settings'],
  });

  const mkUser = async (tenantId: string, role: UserRole) => {
    const [{ id }] = await ds.query(
      `INSERT INTO users (email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, 'x', 'Family Test', 'ACTIVE', NOW(), NOW()) RETURNING id`,
      [`family-${rand()}@example.com`],
    );
    await ds.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())`,
      [id, tenantId, role],
    );
    return id as string;
  };

  // Every test builds fresh tenants: the harness wipes students, fees, exams and routines between tests.
  async function mkTenant(): Promise<Tenant> {
    const [{ id }] = await ds.query(
      `INSERT INTO schools (name, slug) VALUES ('Family Test', $1) RETURNING id`,
      [`family-${rand()}`],
    );
    const [{ id: yearId }] = await ds.query(
      `INSERT INTO academic_years (name, start_date, end_date, is_current, tenant_id)
       VALUES ('2043', '2043-01-01', '2043-12-31', true, $1) RETURNING id`,
      [id],
    );
    const [{ id: classId }] = await ds.query(
      `INSERT INTO classes (name, academic_year_id, tenant_id) VALUES ('Six', $1, $2) RETURNING id`,
      [yearId, id],
    );
    const [{ id: sectionId }] = await ds.query(
      `INSERT INTO class_sections (class_id, section_name, tenant_id) VALUES ($1, 'A', $2) RETURNING id`,
      [classId, id],
    );
    const parentUser = await mkUser(id, UserRole.PARENT);
    const studentUser = await mkUser(id, UserRole.STUDENT);
    const student = async (name: string, userId: string | null) =>
      (
        await ds.query(
          `INSERT INTO students (full_name, registration_number, roll_number, class_section_id, tenant_id, enrollment_status, user_id)
           VALUES ($1, $2, $3, $4, $5, 'ACTIVE', $6) RETURNING id`,
          [name, `REG-${rand()}`, ++roll, sectionId, id, userId],
        )
      )[0].id as string;
    const guardian = async (userId: string | null, phone: string | null) =>
      (
        await ds.query(
          `INSERT INTO guardians (full_name, relationship, phone, user_id, tenant_id)
           VALUES ('Parent', 'Father', $1, $2, $3) RETURNING id`,
          [phone, userId, id],
        )
      )[0].id as string;
    const link = (studentId: string, guardianId: string) =>
      ds.query(`INSERT INTO student_guardians (student_id, guardian_id) VALUES ($1, $2)`, [
        studentId,
        guardianId,
      ]);
    const c1 = await student('Child One', studentUser);
    const c2 = await student('Child Two', null);
    const g1 = await guardian(parentUser, '01700000001');
    const g2 = await guardian(null, '01700000002');
    await link(c1, g1);
    await link(c2, g2);
    const [{ id: structureId }] = await ds.query(
      `INSERT INTO fee_structures (fee_type, name, amount, academic_year_id, tenant_id)
       VALUES ('MONTHLY_TUITION', 'Tuition', 1000, $1, $2) RETURNING id`,
      [yearId, id],
    );
    return {
      id,
      yearId,
      classId,
      sectionId,
      c1,
      c2,
      parentUser,
      studentUser,
      guardianId: g1,
      structureId,
    };
  }

  const mkFee = async (
    t: Tenant,
    studentId: string,
    due: string,
    total = 1000,
    status = 'PENDING',
  ) =>
    (
      await ds.query(
        `INSERT INTO student_fees (student_id, academic_year_id, fee_structure_id, period_start, period_type,
           total_amount, status, due_date)
         VALUES ($1, $2, $3, $4, 'MONTH', $5, $6, $7) RETURNING id`,
        [studentId, t.yearId, t.structureId, `${due.slice(0, 7)}-01`, total, status, due],
      )
    )[0].id as string;

  const mkAbsence = async (t: Tenant, state: string, studentIds: string[]) => {
    const [{ id: sessionId }] = await ds.query(
      `INSERT INTO attendance_sessions (tenant_id, section_id, date, state)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [t.id, t.sectionId, DAY, state],
    );
    for (const sid of studentIds) {
      await ds.query(
        `INSERT INTO attendance_records (tenant_id, session_id, student_id, date, status)
         VALUES ($1, $2, $3, $4, 'ABSENT')`,
        [t.id, sessionId, sid, DAY],
      );
    }
  };

  const mkSubject = async (t: Tenant, name: string) =>
    (
      await ds.query(
        `INSERT INTO subjects (tenant_id, name_en, name_bn, code) VALUES ($1, $2, $2, $3) RETURNING id`,
        [t.id, name, `S-${rand()}`],
      )
    )[0].id as string;

  /** An exam for the tenant's class; `subjects` are component subjects, `scheduled` the ones with a sitting tomorrow. */
  const mkExam = async (t: Tenant, status: string, subjects: string[], scheduled: string[]) => {
    const [{ id: examId }] = await ds.query(
      `INSERT INTO exams (tenant_id, academic_year_id, class_id, name, kind, status)
       VALUES ($1, $2, $3, 'Mid Term', 'TERM', $4) RETURNING id`,
      [t.id, t.yearId, t.classId, status],
    );
    let seq = 0;
    for (const subjectId of subjects) {
      await ds.query(
        `INSERT INTO exam_components (tenant_id, exam_id, subject_id, name, kind, full_marks, sequence)
         VALUES ($1, $2, $3, 'Written', 'WRITTEN', 100, $4)`,
        [t.id, examId, subjectId, ++seq],
      );
    }
    for (const subjectId of scheduled) {
      await ds.query(
        `INSERT INTO exam_schedules (tenant_id, exam_id, subject_id, date, starts_at, ends_at)
         VALUES ($1, $2, $3, $4, '09:00', '11:00')`,
        [t.id, examId, subjectId, TOMORROW],
      );
    }
    return examId;
  };

  const mkResult = async (t: Tenant, examId: string, studentId: string, publishedAt: string) => {
    const [{ id: scaleId }] = await ds.query(
      `INSERT INTO grading_scales (tenant_id, academic_year_id, name) VALUES ($1, $2, 'Scale') RETURNING id`,
      [t.id, t.yearId],
    );
    await ds.query(
      `INSERT INTO results (tenant_id, exam_id, student_id, total_marks, gpa, grade, grading_scale_id,
         grading_scale_revision, rule_version, computed_at, published_at)
       VALUES ($1, $2, $3, 80, 4, 'A', $4, 1, 'v1', NOW(), $5)`,
      [t.id, examId, studentId, scaleId, publishedAt],
    );
  };

  /** A PUBLISHED routine with one Monday period for the tenant's section; returns the routine slot id. */
  const mkRoutineSlot = async (t: Tenant) => {
    const [{ id: routineId }] = await ds.query(
      `INSERT INTO routines (tenant_id, academic_year_id, name, state) VALUES ($1, $2, 'R', 'PUBLISHED') RETURNING id`,
      [t.id, t.yearId],
    );
    const [{ id: shiftId }] = await ds.query(
      `INSERT INTO shifts (tenant_id, name, day_starts_at, day_ends_at, sequence)
       VALUES ($1, $2, '08:00', '14:00', 0) RETURNING id`,
      [t.id, `S-${rand()}`],
    );
    const [{ id: periodSlotId }] = await ds.query(
      `INSERT INTO period_slots (tenant_id, shift_id, sequence, kind, starts_at, ends_at)
       VALUES ($1, $2, 0, $3, '08:00', '08:40') RETURNING id`,
      [t.id, shiftId, PeriodSlotKind.CLASS],
    );
    const subjectId = await mkSubject(t, 'Math');
    const [{ id }] = await ds.query(
      `INSERT INTO routine_slots (tenant_id, routine_id, section_id, period_slot_id, weekday, subject_id,
         recurrence, recurrence_offset, valid_from)
       VALUES ($1, $2, $3, $4, 1, $5, $6, 0, '2043-01-01') RETURNING id`,
      [t.id, routineId, t.sectionId, periodSlotId, subjectId, SlotRecurrence.WEEKLY],
    );
    return id as string;
  };

  const run = async (rule: AttentionRule, t: Tenant) => {
    const c = ctx(t);
    return writer.apply(c, rule, await rule.evaluate(c));
  };
  const alertStatus = async (t: Tenant, ruleKey: string) =>
    (
      await ds.query(`SELECT status FROM alerts WHERE tenant_id = $1 AND rule_key = $2`, [
        t.id,
        ruleKey,
      ])
    ).map((r: { status: string }) => r.status);

  beforeAll(async () => {
    redis = new Redis(process.env.REDIS_URL!);
    const module = await createTestModule(
      ALL_ENTITIES,
      [
        AlertWriterService,
        { provide: TENANT_STATUS_REDIS, useValue: redis },
        // Real resolver, family query and substitutions; only the school calendar is stubbed (every day works).
        ResolveRoutineService,
        FamilyAccessService,
        SubstitutionsService,
        {
          provide: SchoolCalendarService,
          useValue: { getWorkingDays: async () => ({ dates: [DAY] }) },
        },
        ChildAbsentTodayRule,
        FeesDueSoonRule,
        FeesOverdueFamilyRule,
        ExamsTomorrowRule,
        ResultsPublishedRule,
        RoutineChangedTodayRule,
        GuardianProfileIncompleteRule,
      ],
      [],
    );
    ds = module.get(DataSource);
    writer = module.get(AlertWriterService);
    substitutions = module.get(SubstitutionsService);
    absent = module.get(ChildAbsentTodayRule);
    dueSoon = module.get(FeesDueSoonRule);
    overdue = module.get(FeesOverdueFamilyRule);
    examsTomorrow = module.get(ExamsTomorrowRule);
    resultsPublished = module.get(ResultsPublishedRule);
    routineChanged = module.get(RoutineChangedTodayRule);
    profile = module.get(GuardianProfileIncompleteRule);
  }, 60000);

  afterAll(async () => {
    redis.disconnect();
    await ds.destroy();
  });

  beforeEach(async () => {
    A = await mkTenant();
    B = await mkTenant();
  });

  it('child.absent_today: PARENT gets C1; C2 (guardian without login) is kept with no recipients; DRAFT register is silent', async () => {
    await mkAbsence(A, 'DRAFT', [A.c1, A.c2]);
    expect(await absent.evaluate(ctx(A))).toEqual([]);

    // A human finalizes the register: now the absences count.
    await ds.query(`UPDATE attendance_sessions SET state = 'FINALIZED' WHERE tenant_id = $1`, [
      A.id,
    ]);
    const found = await absent.evaluate(ctx(A));
    const byChild = new Map(found.map((f) => [f.subject!.id, f]));
    expect(byChild.size).toBe(2);
    expect(byChild.get(A.c1)!.params).toMatchObject({
      studentName: 'Child One',
      sectionLabel: 'Six-A',
    });
    // The STUDENT login is not a recipient of a PARENT-only rule.
    expect(byChild.get(A.c1)!.recipients).toEqual([
      { userId: A.parentUser, role: UserRole.PARENT, studentId: A.c1 },
    ]);
    expect(byChild.get(A.c2)!.recipients).toEqual([]);
    // Tenant B has the same shape but no absences, and none of A's children leak in.
    expect(await absent.evaluate(ctx(B))).toEqual([]);
  });

  it('fees: due-soon and overdue per child; PAID is silent; B never changes A', async () => {
    await mkFee(A, A.c1, '2043-03-04', 400); // due in 2 days
    await mkFee(A, A.c1, '2043-01-10', 700, 'PAID'); // paid: ignored
    const late = await mkFee(A, A.c1, '2043-02-15', 600); // overdue
    await mkFee(B, B.c1, '2043-02-15', 99000); // B's overdue, bigger
    await mkFee(B, B.c1, '2043-03-04', 88000);

    const [soon] = await dueSoon.evaluate(ctx(A));
    expect(soon.params).toMatchObject({ amount: 400, dueDate: '2043-03-04', studentId: A.c1 });
    // A second fee due later in the window: the sum covers both, so "due by" is the later date.
    await ds.query(
      `INSERT INTO student_fees (student_id, academic_year_id, fee_structure_id, period_start, period_type,
         total_amount, status, due_date)
       VALUES ($1, $2, $3, '2042-12-01', 'MONTH', 300, 'PENDING', '2043-03-05')`,
      [A.c1, A.yearId, A.structureId],
    );
    const [soon2] = await dueSoon.evaluate(ctx(A));
    expect(soon2.params).toMatchObject({ amount: 700, dueDate: '2043-03-05' });
    const [late1] = await overdue.evaluate(ctx(A));
    expect(late1.params).toMatchObject({ amount: 600, oldestDue: '2043-02-15' });
    expect(late1.recipients.map((r) => r.userId)).toEqual([A.parentUser]);

    // Resolves: apply -> ACTIVE; pay the fee; apply again -> RESOLVED.
    await run(overdue, A);
    expect(await alertStatus(A, 'fees.overdue_family')).toEqual(['ACTIVE']);
    await ds.query(`UPDATE student_fees SET status = 'PAID' WHERE id = $1`, [late]);
    expect(await overdue.evaluate(ctx(A))).toEqual([]);
    await run(overdue, A);
    expect(await alertStatus(A, 'fees.overdue_family')).toEqual(['RESOLVED']);
  });

  it('exams.tomorrow: fires to student and parent when fully scheduled; an unscheduled component subject silences it', async () => {
    const math = await mkSubject(A, 'Math');
    const bangla = await mkSubject(A, 'Bangla');
    await mkExam(A, 'DRAFT', [math, bangla], [math, bangla]);
    const found = await examsTomorrow.evaluate(ctx(A));
    const f = found.find((x) => x.subject!.id === A.c1)!;
    expect(f.params).toMatchObject({ date: TOMORROW, startsAt: '09:00' });
    expect(f.recipients.map((r) => r.role).sort()).toEqual([UserRole.PARENT, UserRole.STUDENT]);
    expect(f.expiresAt).toEqual(new Date(`${TOMORROW}T03:00:00Z`));
    expect(await examsTomorrow.evaluate(ctx(B))).toEqual([]);

    // A sitting tomorrow but no components yet: isScheduleComplete is false, the portal shows nothing.
    const maths = await mkSubject(B, 'Math');
    const bare = await mkExam(B, 'DRAFT', [], [maths]);
    expect(await examsTomorrow.evaluate(ctx(B))).toEqual([]);
    await ds.query(`UPDATE exams SET name = 'Bare' WHERE id = $1 AND tenant_id = $2`, [bare, B.id]);

    // A component subject without a sitting: the schedule is incomplete, so families cannot see it.
    const science = await mkSubject(B, 'Science');
    await mkExam(B, 'DRAFT', [science, maths], [maths]);
    expect(await examsTomorrow.evaluate(ctx(B))).toEqual([]);
  });

  it('results.published: a result published an hour ago fires; an exam not PUBLISHED does not', async () => {
    const hourAgo = new Date(NOW.getTime() - 3600_000).toISOString();
    const published = await mkExam(A, 'PUBLISHED', [], []);
    await mkResult(A, published, A.c1, hourAgo);
    const [f] = await resultsPublished.evaluate(ctx(A));
    expect(f.params).toMatchObject({ exam: 'Mid Term', studentId: A.c1 });
    expect(f.expiresAt).toEqual(new Date(new Date(hourAgo).getTime() + 72 * 3600_000));

    const processed = await mkExam(B, 'PROCESSED', [], []);
    await mkResult(B, processed, B.c1, hourAgo);
    expect(await resultsPublished.evaluate(ctx(B))).toEqual([]);
  });

  it('routine.changed_today: a cancelled period reaches the section only; recording it emits both rechecks', async () => {
    const slotId = await mkRoutineSlot(A);
    await mkRoutineSlot(B);
    expect(await routineChanged.evaluate(ctx(A))).toEqual([]);

    const events: AttentionRecheckPayload[] = [];
    const on = (p: AttentionRecheckPayload) => events.push(p);
    attentionEvents.on(ATTENTION_RECHECK, on);
    try {
      await substitutions.record(
        { routine_slot_id: slotId, date: DAY, is_cancelled: true } as never,
        A.id,
        A.parentUser,
      );
    } finally {
      attentionEvents.off(ATTENTION_RECHECK, on);
    }
    expect(events.map((e) => e.ruleKey)).toEqual([
      'routine.substitution_today',
      'routine.changed_today',
    ]);

    const found = await routineChanged.evaluate(ctx(A));
    // C2's guardian has no login and this is not an SMS-fallback rule: no recipient, no finding.
    expect(found.map((f) => f.subject!.id)).toEqual([A.c1]);
    expect(found[0].params).toMatchObject({ cancelled: 1, covered: 0 });
    // B's routine is untouched.
    expect(await routineChanged.evaluate(ctx(B))).toEqual([]);
  });

  it('guardian.profile_incomplete: a PARENT login missing email and second phone; fixed once added', async () => {
    const [f] = await profile.evaluate(ctx(A));
    expect(f.params).toMatchObject({ missing_en: 'email or second phone' });
    expect(f.recipients).toEqual([{ userId: A.parentUser, role: UserRole.PARENT }]);
    // Only guardians WITH a login: g2 (no user) never appears, and B's guardian is B's.
    expect((await profile.evaluate(ctx(B))).map((x) => x.recipients[0].userId)).toEqual([
      B.parentUser,
    ]);

    await ds.query(`UPDATE guardians SET alternate_phone = '01800000000' WHERE id = $1`, [
      A.guardianId,
    ]);
    expect(await profile.evaluate(ctx(A))).toEqual([]);
  });
});
