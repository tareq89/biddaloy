import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Class } from '../academics/entities/class.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { localToday } from '../attendance/attendance-policy.util';
import { SchoolsService } from '../schools/schools.service';
import { StudyPlan } from './entities/study-plan.entity';
import { StudyPlansService } from './study-plans.service';
import { PlanScheduleService } from './plan-schedule.service';

/** Planned pace of one class, summed over its sections' current plans. */
export interface ClassExpected {
  /** round(expected lessons / total lessons * 100). */
  expected_percentage: number;
  /** Past routine periods with no delivery report. */
  not_updated: number;
}

export interface LessonToMark {
  class_name: string;
  section_name: string;
  subject_name_en: string;
  subject_name_bn: string | null;
  planned_on: string;
  lesson_title: string | null;
}

export interface LessonsToMark {
  to_mark: number;
  oldest_planned_on: string | null;
  items: LessonToMark[];
}

/** Expected-by-today of one section x subject plan. */
export interface PlanPace {
  expected: number;
  total: number;
}

/** Newest-first rows shown on the card; `to_mark` is always the full count. */
const TO_MARK_ITEMS = 5;

/**
 * [8.10.7.7.04] Dashboard-side reads of the study-plan schedule (D1: dates are
 * never stored, so "expected by today" always comes from `PlanScheduleService`).
 */
@Injectable()
export class StudyPlanDashboardService {
  constructor(
    @InjectRepository(StudyPlan) private readonly planRepo: Repository<StudyPlan>,
    private readonly plans: StudyPlansService,
    private readonly schedule: PlanScheduleService,
    private readonly schools: SchoolsService,
  ) {}

  /**
   * Per class of the current year that has at least one current plan:
   * expected % by today and the not-updated period count. Classes without a
   * plan are absent from the map.
   */
  async expectedByClass(tenantId: string): Promise<Map<string, ClassExpected>> {
    const pairs = await this.planRepo
      .createQueryBuilder('p')
      .innerJoin(
        ClassSection,
        'cs',
        'cs.id = p.section_id AND cs.tenant_id = :tenantId AND cs.deleted_at IS NULL',
      )
      .innerJoin(
        Class,
        'c',
        'c.id = cs.class_id AND c.tenant_id = :tenantId AND c.deleted_at IS NULL',
      )
      .innerJoin(
        AcademicYear,
        'ay',
        'ay.id = c.academic_year_id AND ay.tenant_id = :tenantId AND ay.is_current = true',
      )
      .select('p.section_id', 'section_id')
      .addSelect('p.subject_id', 'subject_id')
      .addSelect('c.id', 'class_id')
      .where('p.tenant_id = :tenantId', { tenantId })
      .distinct(true)
      .getRawMany<{ section_id: string; subject_id: string; class_id: string }>();
    if (!pairs.length) return new Map();

    const settings = await this.schools.getResolvedSettings(tenantId);
    const today = localToday(settings.region?.timezone ?? 'UTC');
    const current = await Promise.all(
      pairs.map(async (p) => ({
        classId: p.class_id,
        plan: await this.plans.currentPlanFor(tenantId, p.section_id, p.subject_id, today),
      })),
    );
    const live = current.filter((c): c is { classId: string; plan: StudyPlan } => !!c.plan);
    const summaries = await this.schedule.summarize(
      live.map((c) => c.plan),
      tenantId,
    );

    const sums = new Map<string, { expected: number; total: number; notUpdated: number }>();
    for (const { classId, plan } of live) {
      const s = summaries.get(plan.id);
      if (!s) continue;
      const acc = sums.get(classId) ?? { expected: 0, total: 0, notUpdated: 0 };
      acc.expected += s.lessons_done + Math.max(s.lessons_behind, 0);
      acc.total += s.lessons_total;
      acc.notUpdated += s.unreported_periods;
      sums.set(classId, acc);
    }
    const out = new Map<string, ClassExpected>();
    for (const [classId, a] of sums) {
      if (a.total === 0) continue;
      out.set(classId, {
        expected_percentage: Math.round((a.expected / a.total) * 100),
        not_updated: a.notUpdated,
      });
    }
    return out;
  }

  /**
   * [8.10.7.7.05] Past routine periods the teacher still owes a status for:
   * UNREPORTED periods of the plans of their own slots (or slots they cover
   * by substitution). Today never counts (the schedule only owes `date < today`).
   * ponytail: plan `owner_override_teacher` is not consulted, the routine teacher is the owner.
   */
  async lessonsToMark(tenantId: string, userId: string): Promise<LessonsToMark> {
    const empty: LessonsToMark = { to_mark: 0, oldest_planned_on: null, items: [] };
    const m = this.planRepo.manager;
    const [teacher] = await m.query(
      `SELECT id FROM teachers WHERE tenant_id = $1 AND user_id = $2 AND deleted_at IS NULL`,
      [tenantId, userId],
    );
    if (!teacher) return empty;
    const me: string = teacher.id;
    const mine: { id: string }[] = await m.query(
      `SELECT routine_slot_id AS id FROM routine_slot_teachers WHERE tenant_id = $1 AND teacher_id = $2
       UNION
       SELECT routine_slot_id FROM routine_substitutions
        WHERE tenant_id = $1 AND substitute_teacher_id = $2 AND is_cancelled = false`,
      [tenantId, me],
    );
    if (!mine.length) return empty;
    const slotIds = new Set(mine.map((r) => r.id));
    const pairs: {
      section_id: string;
      subject_id: string;
      class_name: string;
      section_name: string;
      subject_name_en: string;
      subject_name_bn: string | null;
    }[] = await m.query(
      `SELECT DISTINCT s.section_id, s.subject_id, c.name AS class_name, cs.section_name,
              sub.name_en AS subject_name_en, sub.name_bn AS subject_name_bn
         FROM routine_slots s
         JOIN class_sections cs ON cs.id = s.section_id AND cs.tenant_id = $1
         JOIN classes c ON c.id = cs.class_id AND c.tenant_id = $1
         JOIN subjects sub ON sub.id = s.subject_id AND sub.tenant_id = $1
        WHERE s.tenant_id = $1 AND s.id = ANY($2::uuid[])`,
      [tenantId, [...slotIds]],
    );
    const settings = await this.schools.getResolvedSettings(tenantId);
    const today = localToday(settings.region?.timezone ?? 'UTC');
    const found = await Promise.all(
      pairs.map(async (p) => ({
        p,
        plan: await this.plans.currentPlanFor(tenantId, p.section_id, p.subject_id, today),
      })),
    );
    const live = found.filter((f): f is { p: (typeof pairs)[number]; plan: StudyPlan } => !!f.plan);
    const schedules = await this.schedule.schedulesFor(
      live.map((f) => f.plan),
      tenantId,
    );
    const rows: LessonToMark[] = [];
    for (const { p, plan } of live) {
      const sch = schedules.get(plan.id);
      if (!sch) continue;
      for (const per of sch.periods) {
        if (per.status !== 'UNREPORTED' || per.kind !== 'ROUTINE') continue;
        // A substituted period belongs to the substitute only; otherwise to the slot's teacher.
        const mineToMark = per.substitute_teacher_id
          ? per.substitute_teacher_id === me
          : !!per.routine_slot_id && slotIds.has(per.routine_slot_id);
        if (!mineToMark) continue;
        const lesson = sch.lessons.find(
          (l) =>
            l.expected_date &&
            l.expected_end_date &&
            l.expected_date <= per.date &&
            per.date <= l.expected_end_date,
        );
        rows.push({
          class_name: p.class_name,
          section_name: p.section_name,
          subject_name_en: p.subject_name_en,
          subject_name_bn: p.subject_name_bn,
          planned_on: per.date,
          lesson_title: lesson?.title ?? null,
        });
      }
    }
    if (!rows.length) return empty;
    rows.sort((a, b) => b.planned_on.localeCompare(a.planned_on));
    return {
      to_mark: rows.length,
      oldest_planned_on: rows[rows.length - 1]!.planned_on,
      items: rows.slice(0, TO_MARK_ITEMS),
    };
  }

  /**
   * [8.10.7.7.05] Pace of each section x subject asked about, keyed
   * `section_id|subject_id`. A pair with no current plan is absent.
   */
  async expectedForTeacher(
    tenantId: string,
    pairs: { section_id: string; subject_id: string }[],
  ): Promise<Map<string, PlanPace>> {
    const out = new Map<string, PlanPace>();
    if (!pairs.length) return out;
    const settings = await this.schools.getResolvedSettings(tenantId);
    const today = localToday(settings.region?.timezone ?? 'UTC');
    const found = await Promise.all(
      pairs.map(async (p) => ({
        key: `${p.section_id}|${p.subject_id}`,
        plan: await this.plans.currentPlanFor(tenantId, p.section_id, p.subject_id, today),
      })),
    );
    const live = found.filter((f): f is { key: string; plan: StudyPlan } => !!f.plan);
    const summaries = await this.schedule.summarize(
      live.map((f) => f.plan),
      tenantId,
    );
    for (const { key, plan } of live) {
      const s = summaries.get(plan.id);
      if (!s || s.lessons_total === 0) continue;
      out.set(key, {
        expected: s.lessons_done + Math.max(s.lessons_behind, 0),
        total: s.lessons_total,
      });
    }
    return out;
  }
}
