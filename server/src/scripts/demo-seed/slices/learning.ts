import {
  EnrollmentStatus,
  HomeworkAssignmentStatus,
  HomeworkGradingMode,
  HomeworkSubmissionStatus,
  LessonDeliveryReason,
  LessonDeliveryStatus,
  ProgramEnrollmentStatus,
  SyllabusTopicStatus,
} from '@biddaloy/shared';
import { School } from '../../../modules/schools/entities/school.entity';
import { TenantSettingsCache } from '../../../modules/schools/settings/tenant-settings-cache.service';
import { Homework } from '../../../modules/homework/entities/homework.entity';
import { HomeworkAssignment } from '../../../modules/homework/entities/homework-assignment.entity';
import { HomeworkSubmission } from '../../../modules/homework/entities/homework-submission.entity';
import { SyllabusTopic } from '../../../modules/homework/entities/syllabus-topic.entity';
import { StudyPlan } from '../../../modules/study-plans/entities/study-plan.entity';
import { StudyPlanTemplate } from '../../../modules/study-plans/entities/study-plan-template.entity';
import { LessonDelivery } from '../../../modules/study-plans/entities/lesson-delivery.entity';
import { Program } from '../../../modules/programs/entities/program.entity';
import { ProgramMilestone } from '../../../modules/programs/entities/program-milestone.entity';
import { ProgramEnrollment } from '../../../modules/programs/entities/program-enrollment.entity';
import { MilestoneAchievement } from '../../../modules/programs/entities/milestone-achievement.entity';
import { HOMEWORK_TITLES, PROGRAM_NAMES } from '../../seed-data/demo-bn/texts';
import { insertChunked } from '../bulk';
import type { DemoSeedContext, DemoSlice } from '../context';
import { schoolDays } from '../dates';
import { calendarOffDays } from './attendance';
import { orgIds } from './org';
import { CODE_OF } from './routine';
import { studentIds } from './students';

/**
 * [58.3.04] What teachers and families see of learning: homework (with defaulters), syllabus
 * topics, study plans with lesson deliveries, and extracurricular programs with milestones.
 * Everything is bulk-inserted (D38) from ids the earlier slices published or the database holds.
 */

const OFF_DAY = 5; // Friday
const DAY = 86_400_000;
const addDays = (date: string, n: number) =>
  new Date(Date.parse(date) + n * DAY).toISOString().slice(0, 10);
/** A past date that lands on a school day: Friday moves back to Thursday. */
const onSchoolDay = (date: string) =>
  new Date(`${date}T00:00:00Z`).getUTCDay() === OFF_DAY ? addDays(date, -1) : date;
const bnNum = (n: number) => String(n).replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[Number(d)]);

/** Homework due dates (days from the anchor) of the current year; the first three are "this week". */
const CURRENT_DUE = [1, 0, -1, -7, -14, -21];
/** Previous years only carry a few: this many days after the year starts. ponytail: no older history. */
const PAST_DUE_FROM_START = [60, 120, 180];
const SUBMITTED_RATE = 0.85;
const YESTERDAY_SUBMITTED_RATE = 0.9;
const TOPICS_PER_SUBJECT = 6;
const COVERED_RATE = 0.6;
const UNREPORTED_RATE = 0.05;
/** Lesson deliveries cover this many days before the anchor. ponytail: 4 weeks, not the whole term. */
const DELIVERY_DAYS = 28;
const ENROLL_RATE = 0.2;

const PROGRAM_MILESTONES: Record<string, (i: number) => string> = {
  Scouts: (i) =>
    [
      'প্রবেশিকা ব্যাজ',
      'তাঁবু স্থাপন',
      'প্রাথমিক চিকিৎসা',
      'মানচিত্র পাঠ',
      'রান্না ব্যাজ',
      'সেবা ব্যাজ',
      'পর্বতারোহণ',
      'প্রেসিডেন্ট স্কাউট',
    ][i],
  'Debate Club': (i) => `বিতর্ক রাউন্ড ${bnNum(i + 1)}`,
  'Science Club': (i) => `বিজ্ঞান প্রকল্প ${bnNum(i + 1)}`,
  'Cricket Team': (i) =>
    [
      'নেট অনুশীলন',
      'আন্তঃশ্রেণি ম্যাচ',
      'আন্তঃবিদ্যালয় ম্যাচ',
      'উপজেলা টুর্নামেন্ট',
      'জেলা টুর্নামেন্ট',
    ][i],
  'Cultural Club': (i) => ['আবৃত্তি', 'সংগীত', 'নৃত্য', 'নাটক', 'বার্ষিক অনুষ্ঠানে অংশগ্রহণ'][i],
  Hifz: (i) => `পারা ${bnNum(i + 1)} সম্পন্ন`,
};
const MILESTONE_COUNT: Record<string, number> = {
  Scouts: 8,
  'Debate Club': 5,
  'Science Club': 5,
  'Cricket Team': 5,
  'Cultural Club': 5,
  Hifz: 30,
};

interface ClassSubjectRow {
  class_id: string;
  subject_id: string;
  name_en: string;
  name_bn: string | null;
  group_name: string | null;
}

export const slice: DemoSlice = {
  name: 'learning',
  covers: [
    Homework,
    HomeworkAssignment,
    HomeworkSubmission,
    SyllabusTopic,
    StudyPlan,
    StudyPlanTemplate,
    LessonDelivery,
    Program,
    ProgramMilestone,
    ProgramEnrollment,
    MilestoneAchievement,
  ],
  run: async (ctx: DemoSeedContext) => {
    const org = orgIds(ctx);
    const { students, bySection } = studentIds(ctx);
    const uuid = () => ctx.rng.string.uuid();
    const repo = (e: Function) => ctx.ds.getRepository(e as never);
    let rows = 0;

    // The defaulter sweep is a no-op unless the school opts in, so opt the demo schools in.
    const schoolRepo = ctx.ds.getRepository(School);
    for (const t of org.tenants) {
      const school = await schoolRepo.findOneByOrFail({ id: t.id });
      const hw = (school.settings?.homework ?? {}) as Record<string, unknown>;
      school.settings = { ...school.settings, homework: { ...hw, notifyDefaulters: true } };
      await schoolRepo.save(school);
      ctx.app.get(TenantSettingsCache).invalidate(t.id);
    }

    const homework: Record<string, unknown>[] = [];
    const assignments: Record<string, unknown>[] = [];
    const submissions: Record<string, unknown>[] = [];
    const topics: Record<string, unknown>[] = [];
    const plans: Record<string, unknown>[] = [];
    const templates: Record<string, unknown>[] = [];

    // ---- 1-3. homework, syllabus, study plan templates ------------------------------------------
    // current (class, subject) -> its topics, for the study plan lessons
    const topicsOf = new Map<string, { id: string; name: string }[]>();
    const termOf = new Map<string, string | null>(); // current year id -> the term holding the anchor
    for (const t of org.tenants) {
      const cur = t.years[t.years.length - 1];
      const found: { id: string; start_date: string; end_date: string }[] = await ctx.ds.query(
        `SELECT id, start_date::text, end_date::text FROM academic_terms
          WHERE tenant_id = $1 AND academic_year_id = $2 ORDER BY seq`,
        [t.id, cur.id],
      );
      termOf.set(
        cur.id,
        found.find((x) => x.start_date <= ctx.anchor && ctx.anchor <= x.end_date)?.id ?? null,
      );

      const subjects: ClassSubjectRow[] = await ctx.ds.query(
        `SELECT cs.class_id, cs.subject_id, s.name_en, s.name_bn, cs.group_name
           FROM class_subjects cs JOIN subjects s ON s.id = cs.subject_id
          WHERE cs.tenant_id = $1 AND cs.deleted_at IS NULL ORDER BY s.code`,
        [t.id],
      );
      const byClass = new Map<string, ClassSubjectRow[]>();
      for (const cs of subjects)
        (byClass.get(cs.class_id) ?? byClass.set(cs.class_id, []).get(cs.class_id)!).push(cs);

      // The current and the previous year carry homework (history beyond is not shown anywhere).
      for (const [yi, year] of t.years.entries()) {
        const isCurrent = yi === t.years.length - 1;
        if (yi < t.years.length - 2) continue;
        const dues = isCurrent
          ? CURRENT_DUE.map((d) => addDays(ctx.anchor, d))
          : PAST_DUE_FROM_START.map((d) => addDays(year.start, d));
        for (const klass of year.classes) {
          for (const cs of byClass.get(klass.id) ?? []) {
            const code = CODE_OF[cs.name_en.replace(/ \(HSC\)$/, '')];
            const titles = HOMEWORK_TITLES[code] ?? ['অধ্যায়ের অনুশীলনী সমাধান করো'];
            const sections = klass.sections.filter(
              (s) => !cs.group_name || s.group === cs.group_name,
            );
            if (!sections.length) continue;

            if (isCurrent) {
              const ts = Array.from({ length: TOPICS_PER_SUBJECT }, (_, i) => ({
                id: uuid(),
                name: `${cs.name_bn ?? cs.name_en}: অধ্যায় ${bnNum(i + 1)}`,
              }));
              topicsOf.set(`${klass.id}|${cs.subject_id}`, ts);
              const covered = Math.round(TOPICS_PER_SUBJECT * COVERED_RATE);
              ts.forEach((tp, i) =>
                topics.push({
                  id: tp.id,
                  tenant_id: t.id,
                  class_id: klass.id,
                  subject_id: cs.subject_id,
                  name: tp.name,
                  sequence: i + 1,
                  status:
                    i < covered
                      ? SyllabusTopicStatus.DONE
                      : i === covered
                        ? SyllabusTopicStatus.IN_PROGRESS
                        : SyllabusTopicStatus.PLANNED,
                }),
              );
            }

            dues.forEach((rawDue, di) => {
              const due = di < 3 && isCurrent ? rawDue : onSchoolDay(rawDue);
              const hwId = uuid();
              homework.push({
                id: hwId,
                tenant_id: t.id,
                title: ctx.pick(titles),
                description: null,
                subject_id: cs.subject_id,
                class_id: klass.id,
                grading_mode: HomeworkGradingMode.TICK,
                attachments: [],
              });
              for (const section of sections) {
                const asgId = uuid();
                assignments.push({
                  id: asgId,
                  homework_id: hwId,
                  section_id: section.id,
                  student_id: null,
                  assigned_date: addDays(due, -3) < ctx.anchor ? addDays(due, -3) : ctx.anchor,
                  due_date: due,
                  status: HomeworkAssignmentStatus.ACTIVE,
                  tenant_id: t.id,
                });
                const pupils = bySection.get(section.id) ?? [];
                // Rates by when the homework falls due: tomorrow and today are still open.
                const rate =
                  !isCurrent || due < addDays(ctx.anchor, -1)
                    ? SUBMITTED_RATE
                    : due === addDays(ctx.anchor, -1)
                      ? YESTERDAY_SUBMITTED_RATE
                      : due === ctx.anchor
                        ? 0.5
                        : 0.2;
                const settled = due < ctx.anchor;
                const rowsOfAsg = pupils.map((studentId) => ({
                  id: uuid(),
                  assignment_id: asgId,
                  student_id: studentId,
                  status:
                    ctx.rng.number.float() < rate
                      ? settled && !isRecent(due, ctx.anchor)
                        ? HomeworkSubmissionStatus.DONE
                        : HomeworkSubmissionStatus.SUBMITTED
                      : HomeworkSubmissionStatus.NOT_SUBMITTED,
                  marks: null,
                  attachments: [],
                  tenant_id: t.id,
                }));
                // Yesterday always has at least one defaulter, so the homework-defaulter job has input.
                if (
                  isCurrent &&
                  due === addDays(ctx.anchor, -1) &&
                  rowsOfAsg.length &&
                  !rowsOfAsg.some((r) => r.status === HomeworkSubmissionStatus.NOT_SUBMITTED)
                ) {
                  rowsOfAsg[rowsOfAsg.length - 1].status = HomeworkSubmissionStatus.NOT_SUBMITTED;
                }
                submissions.push(...rowsOfAsg);
              }
            });
          }
        }
        if (isCurrent) {
          // One template per branch (names are unique per branch), from the middle class's first subject.
          const klass = year.classes[Math.floor(year.classes.length / 2)];
          const cs = (byClass.get(klass.id) ?? [])[0];
          const code = cs ? CODE_OF[cs.name_en.replace(/ \(HSC\)$/, '')] : undefined;
          if (code) {
            templates.push({
              tenant_id: t.id,
              name: `${klass.name} ${cs.name_bn ?? cs.name_en} বার্ষিক পাঠ পরিকল্পনা`,
              class_grade: klass.numericGrade,
              subject_code: code,
              lessons: Array.from({ length: TOPICS_PER_SUBJECT }, (_, i) => ({
                id: uuid(),
                title: `অধ্যায় ${bnNum(i + 1)}`,
                periods: 2 + (i % 3),
              })),
            });
          }
        }
      }
    }
    rows += await insertChunked(repo(Homework) as never, homework as never);
    rows += await insertChunked(repo(HomeworkAssignment) as never, assignments as never);
    rows += await insertChunked(repo(HomeworkSubmission) as never, submissions as never, 2000);
    rows += await insertChunked(repo(SyllabusTopic) as never, topics as never);
    rows += await insertChunked(repo(StudyPlanTemplate) as never, templates as never);

    // ---- 3b. study plans + lesson deliveries, from the current routine ---------------------------
    const slots: {
      tenant_id: string;
      section_id: string;
      class_id: string;
      subject_id: string;
      weekday: number;
      period_slot_id: string;
      year_id: string;
      user_id: string | null;
    }[] = await ctx.ds.query(
      `SELECT rs.tenant_id, rs.section_id, cs.class_id, rs.subject_id, rs.weekday, rs.period_slot_id,
              r.academic_year_id AS year_id, (SELECT te.user_id FROM routine_slot_teachers rst
                 JOIN teachers te ON te.id = rst.teacher_id WHERE rst.routine_slot_id = rs.id ORDER BY te.id LIMIT 1) AS user_id
         FROM routine_slots rs
         JOIN routines r ON r.id = rs.routine_id
         JOIN academic_years y ON y.id = r.academic_year_id AND y.is_current
         JOIN class_sections cs ON cs.id = rs.section_id
         JOIN period_slots ps ON ps.id = rs.period_slot_id
        WHERE rs.tenant_id = ANY($1) AND r.deleted_at IS NULL
        ORDER BY rs.section_id, ps.sequence, rs.weekday, rs.id`,
      [org.tenants.map((t) => t.id)],
    );
    const planned = new Set<string>();
    for (const s of slots) {
      const key = `${s.section_id}|${s.subject_id}`;
      if (planned.has(key)) continue;
      planned.add(key);
      const ts = topicsOf.get(`${s.class_id}|${s.subject_id}`) ?? [];
      plans.push({
        tenant_id: s.tenant_id,
        academic_year_id: s.year_id,
        academic_term_id: termOf.get(s.year_id) ?? null,
        section_id: s.section_id,
        subject_id: s.subject_id,
        lessons: ts.map((tp, i) => ({
          id: uuid(),
          title: tp.name,
          periods: 2 + (i % 3),
          topic_id: tp.id,
        })),
        exam_markers: [],
      });
    }
    rows += await insertChunked(repo(StudyPlan) as never, plans as never);

    // The branch calendar's non-working days, the same ones the attendance slice skips: no lesson is
    // "taught" on a day with no register.
    const { tenantOff, classOff } = await calendarOffDays(
      ctx.ds,
      org.tenants.map((t) => t.id),
    );
    const days = schoolDays(addDays(ctx.anchor, -DELIVERY_DAYS), addDays(ctx.anchor, -1), [
      OFF_DAY,
    ]);
    const deliveries: Record<string, unknown>[] = [];
    for (const day of days) {
      const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
      const seen = new Set<string>(); // one delivery per section + period (electives share a period)
      for (const s of slots.filter((x) => x.weekday === weekday)) {
        if (tenantOff.get(s.tenant_id)?.has(day) || classOff.get(s.class_id)?.has(day)) continue;
        const k = `${s.section_id}|${s.period_slot_id}`;
        if (seen.has(k)) continue;
        seen.add(k);
        if (ctx.rng.number.float() < UNREPORTED_RATE) continue; // no delivery was recorded
        const roll = ctx.rng.number.float();
        const status =
          roll < 0.04
            ? LessonDeliveryStatus.NOT_TAUGHT
            : roll < 0.1
              ? LessonDeliveryStatus.PARTLY
              : LessonDeliveryStatus.TAUGHT;
        deliveries.push({
          tenant_id: s.tenant_id,
          section_id: s.section_id,
          subject_id: s.subject_id,
          date: day,
          period_slot_id: s.period_slot_id,
          status,
          reason:
            status === LessonDeliveryStatus.NOT_TAUGHT
              ? ctx.pick([
                  LessonDeliveryReason.TEACHER_ABSENT,
                  LessonDeliveryReason.ON_LEAVE,
                  LessonDeliveryReason.OTHER,
                ])
              : null,
          is_extra: false,
          auto: false,
          recorded_by_user_id: s.user_id,
        });
      }
    }
    rows += await insertChunked(repo(LessonDelivery) as never, deliveries as never, 2000);

    // ---- 4. programs: six per branch (Hifz not in College), milestones, enrollments --------------
    const yearEnd = new Map(org.tenants.flatMap((t) => t.years.map((y) => [y.id, y] as const)));
    const programs: Record<string, unknown>[] = [];
    const milestones: Record<string, unknown>[] = [];
    const milestonesOf = new Map<string, string[]>(); // program id -> milestone ids in order
    const programsOf = new Map<string, string[]>(); // tenant id -> program ids
    for (const t of org.tenants) {
      for (const p of PROGRAM_NAMES.filter((n) => t.kind !== 'COLLEGE' || n.en !== 'Hifz')) {
        const id = uuid();
        programs.push({
          id,
          tenant_id: t.id,
          name: p.en,
          description: p.bn,
          is_active: true,
          show_on_report_card: p.en === 'Scouts',
        });
        (programsOf.get(t.id) ?? programsOf.set(t.id, []).get(t.id)!).push(id);
        const ids = Array.from({ length: MILESTONE_COUNT[p.en] }, (_, i) => {
          const mid = uuid();
          milestones.push({
            id: mid,
            tenant_id: t.id,
            program_id: id,
            name: PROGRAM_MILESTONES[p.en](i),
            sequence: i + 1,
          });
          return mid;
        });
        milestonesOf.set(id, ids);
      }
    }
    rows += await insertChunked(repo(Program) as never, programs as never);
    rows += await insertChunked(repo(ProgramMilestone) as never, milestones as never);

    const enrollments: Record<string, unknown>[] = [];
    const achievements: Record<string, unknown>[] = [];
    for (const t of org.tenants) {
      const mine = students.filter((s) => s.tenantId === t.id);
      const pool = ctx.rng.helpers.shuffle(mine);
      const pids = programsOf.get(t.id)!;
      // At least one per program, so every program has an achievement even at a tiny scale.
      const n = Math.min(pool.length, Math.max(pids.length, Math.round(mine.length * ENROLL_RATE)));
      pool.slice(0, n).forEach((s, i) => {
        const programId = pids[i % pids.length];
        const stay = ctx.pick(s.stays);
        const year = yearEnd.get(stay.yearId)!;
        // Nothing after yesterday: the current year's stay of a student who left this year ends by then.
        const yesterday = addDays(ctx.anchor, -1);
        const early = (d: string) => (d < yesterday ? d : yesterday);
        const startedOn = early(addDays(year.start, ctx.rng.number.int({ min: 10, max: 60 })));
        const active = s.status === EnrollmentStatus.ACTIVE;
        const endedOn = active ? null : early(year.end);
        const enrollmentId = uuid();
        enrollments.push({
          id: enrollmentId,
          tenant_id: t.id,
          program_id: programId,
          student_id: s.id,
          started_on: startedOn,
          ended_on: endedOn,
          status: active ? ProgramEnrollmentStatus.ACTIVE : ProgramEnrollmentStatus.COMPLETED,
        });
        const last = endedOn ?? addDays(ctx.anchor, -1);
        const span = Math.max(1, Math.floor((Date.parse(last) - Date.parse(startedOn)) / DAY));
        const ms = milestonesOf.get(programId)!;
        const count = ctx.rng.number.int({ min: 1, max: Math.min(ms.length, 6) });
        for (let k = 0; k < count; k++) {
          achievements.push({
            tenant_id: t.id,
            program_id: programId,
            enrollment_id: enrollmentId,
            milestone_id: ms[k],
            achieved_on: addDays(startedOn, Math.floor((span * (k + 1)) / (count + 1))),
            recorded_by: org.adminUserId,
          });
        }
      });
    }
    rows += await insertChunked(repo(ProgramEnrollment) as never, enrollments as never);
    rows += await insertChunked(repo(MilestoneAchievement) as never, achievements as never);
    return rows;
  },
};

/** Within the last week of the anchor: a teacher has not ticked it off yet, so it reads SUBMITTED. */
function isRecent(due: string, anchor: string): boolean {
  return Date.parse(anchor) - Date.parse(due) <= 7 * DAY;
}
