import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { Between, IsNull, Repository } from 'typeorm';
import {
  LessonDeliveryStatus,
  NOT_A_PERIOD_REASONS,
  RoutineState,
  UserRole,
  hasTenantDataScope,
} from '@biddaloy/shared';
import type { StudyPlanLesson } from '@biddaloy/shared';
import { StudyPlan } from './entities/study-plan.entity';
import { LessonDelivery } from './entities/lesson-delivery.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { AcademicTerm } from '../calendar/entities/academic-term.entity';
import { PeriodSlot } from '../routines/entities/period-slot.entity';
import { Routine } from '../routines/entities/routine.entity';
import { ResolveRoutineService } from '../routines/resolve-routine.service';
import type { ResolvedSlot } from '../routines/dto/resolve.dto';
import { SchoolsService } from '../schools/schools.service';
import { localDate, localToday } from '../attendance/attendance-policy.util';
import { StudyPlanCaller, StudyPlansService } from './study-plans.service';
import type {
  CarryOverResponseDto,
  ListStudyPlansWithSummaryQueryDto,
  PlanCapacityDto,
  PlanCapacityResponseDto,
  PlanScheduleResponseDto,
  PlanSummaryDto,
  ScheduleLessonDto,
  SchedulePeriodDto,
} from './dto/plan-schedule.dto';
import type { StudyPlanBaseDto } from './dto/study-plan.dto';

// ---------------------------------------------------------------- pure mapping

export type SchedulePeriod = SchedulePeriodDto;
export type ScheduleLesson = ScheduleLessonDto;

/** The delivery columns the mapping reads (all subjects of the section). */
export type DeliveryInput = Pick<
  LessonDelivery,
  'date' | 'period_slot_id' | 'subject_id' | 'status' | 'reason' | 'is_extra'
>;

export interface MapInput {
  lessons: StudyPlanLesson[];
  subjectId: string;
  /** Resolver slots of this subject only. */
  occurrences: ResolvedSlot[];
  /** Every delivery of the section in the range, any subject. */
  deliveries: DeliveryInput[];
  periodSequence: Map<string, number>;
  today: string;
  rangeStart?: string;
  rangeEnd: string;
  /** Local date the plan was created: an unrecorded routine period before it is not owed. */
  planStart?: string;
}

export interface MapResult {
  periods: SchedulePeriod[];
  lessons: ScheduleLesson[];
  periods_behind: number;
  lessons_behind: number;
  lessons_done: number;
  lessons_total: number;
  owed_by_today: number;
  taught: number;
  capacity: PlanCapacityDto;
  unreported: { periods: number; school_days: number; oldest_date: string | null };
}

const NOT_A_PERIOD: readonly string[] = NOT_A_PERIOD_REASONS;

/**
 * D1/D7/D23/D24/D39/D40: lay the ordered lessons over the dated periods. Pure:
 * no DB, no clock (`today` is an input). Dates are never stored; every call
 * recomputes from the routine occurrences and the delivery log.
 * ponytail: linear walk per plan; batch by section if list pages get slow.
 */
export function mapLessonsToPeriods(input: MapInput): MapResult {
  const { lessons, subjectId, today, rangeStart, rangeEnd } = input;
  const inRange = (d: string) => d <= rangeEnd && (!rangeStart || d >= rangeStart);
  const key = (date: string, slot: string) => `${date}|${slot}`;

  const occ = new Map<string, ResolvedSlot>();
  for (const o of input.occurrences) if (inRange(o.date)) occ.set(key(o.date, o.period_slot_id), o);
  const own = new Map<string, DeliveryInput>();
  const otherExtra = new Set<string>();
  for (const d of input.deliveries) {
    if (!inRange(d.date)) continue;
    const k = key(d.date, d.period_slot_id);
    if (d.subject_id === subjectId) own.set(k, d);
    else if (d.is_extra && d.status !== LessonDeliveryStatus.NOT_TAUGHT) otherExtra.add(k);
  }

  // Every period of this subject: its occurrences plus deliveries with no occurrence (extras).
  const keys = [...new Set([...occ.keys(), ...own.keys()])];
  const parse = (k: string) => {
    const [date, slot] = k.split('|');
    return { date, slot };
  };
  keys.sort((a, b) => {
    const pa = parse(a);
    const pb = parse(b);
    if (pa.date !== pb.date) return pa.date < pb.date ? -1 : 1;
    const sa = input.periodSequence.get(pa.slot) ?? 0;
    const sb = input.periodSequence.get(pb.slot) ?? 0;
    return sa !== sb ? sa - sb : pa.slot < pb.slot ? -1 : 1;
  });

  const sl: ScheduleLesson[] = lessons.map((l) => ({
    id: l.id,
    title: l.title,
    periods: l.periods,
    taught_periods: 0,
    status: 'UPCOMING',
    expected_date: null,
    expected_end_date: null,
    overflow: false,
    in_extra_class: false,
  }));
  const allocated = sl.map(() => 0);
  const touched = sl.map(() => false);

  const periods: SchedulePeriod[] = [];
  const unreportedDates: string[] = [];
  let cur = 0; // lesson index the next consuming period lands on
  let curUsed = 0; // periods already consumed in that lesson
  let owed = 0;
  let taught = 0;
  // Counts FUTURE periods only: today's already-marked period is gone, and periods_needed excludes it too.
  let periodsLeft = 0;

  /** Spend one period on the current lesson (taught or planned). */
  const consume = (date: string, extra: boolean, real: boolean): string | null => {
    if (cur >= sl.length) return null;
    const l = sl[cur];
    const idx = cur;
    allocated[idx]++;
    l.expected_date ??= date;
    l.expected_end_date = date;
    if (real) l.taught_periods++;
    if (extra) l.in_extra_class = true;
    curUsed++;
    if (curUsed >= l.periods) {
      cur++;
      curUsed = 0;
    }
    return l.id;
  };

  for (const k of keys) {
    const { date, slot } = parse(k);
    const o = occ.get(k);
    const d = own.get(k);
    const kind = d?.is_extra || !o ? 'EXTRA' : 'ROUTINE';
    const base = {
      date,
      period_slot_id: slot,
      kind,
      ...(o ? { routine_slot_id: o.routine_slot_id } : {}),
      ...(o?.substitute_teacher_id ? { substitute_teacher_id: o.substitute_teacher_id } : {}),
    } as const;
    const excluded = (reason: string) =>
      periods.push({ ...base, status: 'EXCLUDED', reason, lesson_id: null });

    // A plan made mid-term does not owe the periods before it existed (recorded ones still count).
    if (!d && input.planStart && date < input.planStart) continue;

    if (o?.cancelled) {
      excluded('CANCELLED');
      continue;
    }
    if (d?.status === LessonDeliveryStatus.NOT_TAUGHT && NOT_A_PERIOD.includes(d.reason ?? '')) {
      excluded(d.reason as string);
      continue;
    }
    if (o && !d && otherExtra.has(k)) {
      excluded('OTHER_SUBJECT_EXTRA');
      continue;
    }
    if (o && date < today) owed++;

    if (d?.status === LessonDeliveryStatus.TAUGHT) {
      taught++;
      const lesson_id = consume(date, kind === 'EXTRA', true);
      periods.push({ ...base, status: 'TAUGHT', lesson_id });
    } else if (d?.status === LessonDeliveryStatus.PARTLY) {
      touched[cur] = true;
      if (kind === 'EXTRA' && cur < sl.length) sl[cur].in_extra_class = true;
      periods.push({ ...base, status: 'PARTLY', lesson_id: sl[cur]?.id ?? null });
    } else if (d) {
      // NOT_TAUGHT with an owed reason (TEACHER_ABSENT, ON_LEAVE, OTHER): behind, not consumed.
      periods.push({
        ...base,
        status: 'NOT_TAUGHT',
        reason: d.reason ?? undefined,
        lesson_id: null,
      });
    } else if (date < today) {
      periods.push({ ...base, status: 'UNREPORTED', lesson_id: null });
      unreportedDates.push(date);
    } else {
      periodsLeft++;
      periods.push({ ...base, status: 'FUTURE', lesson_id: consume(date, false, false) });
    }
  }

  let lessonsDone = 0;
  let needed = 0;
  sl.forEach((l, i) => {
    l.overflow = allocated[i] < l.periods;
    if (l.taught_periods >= l.periods) {
      l.status = 'DONE';
      lessonsDone++;
    } else {
      needed += l.periods - l.taught_periods;
      l.status = l.taught_periods > 0 || touched[i] ? 'IN_PROGRESS' : 'UPCOMING';
    }
  });

  // "Should be done by today": leading lessons whose periods fit inside the owed periods.
  let acc = 0;
  let shouldDone = 0;
  for (const l of sl) {
    acc += l.periods;
    if (acc > owed) break;
    shouldDone++;
  }

  return {
    periods,
    lessons: sl,
    periods_behind: owed - taught,
    lessons_behind: Math.max(0, shouldDone - lessonsDone),
    lessons_done: lessonsDone,
    lessons_total: sl.length,
    owed_by_today: owed,
    taught,
    capacity: { periods_left: periodsLeft, periods_needed: needed, fits: needed <= periodsLeft },
    unreported: {
      periods: unreportedDates.length,
      school_days: new Set(unreportedDates).size,
      oldest_date: unreportedDates[0] ?? null,
    },
  };
}

// ---------------------------------------------------------------- service

const isoDate = (v: string | Date): string =>
  typeof v === 'string' ? v : v.toISOString().slice(0, 10);

interface Range {
  from: string;
  to: string;
}

type Scope = Pick<StudyPlan, 'subject_id' | 'lessons'>;

export type PlanSchedule = PlanScheduleResponseDto & { raw: MapResult };

/**
 * [66.2.02/#2007] Dated schedule for a plan: expected date and status of every
 * lesson, behind counts, capacity and unreported periods. Only the routine
 * resolver (PUBLISHED-only, as attendance does) and the delivery log feed it.
 */
@Injectable()
export class PlanScheduleService {
  constructor(
    @InjectRepository(StudyPlan) private readonly planRepo: Repository<StudyPlan>,
    @InjectRepository(LessonDelivery) private readonly deliveryRepo: Repository<LessonDelivery>,
    @InjectRepository(AcademicYear) private readonly yearRepo: Repository<AcademicYear>,
    @InjectRepository(AcademicTerm) private readonly termRepo: Repository<AcademicTerm>,
    @InjectRepository(PeriodSlot) private readonly periodSlotRepo: Repository<PeriodSlot>,
    @InjectRepository(Routine) private readonly routineRepo: Repository<Routine>,
    private readonly resolver: ResolveRoutineService,
    private readonly schools: SchoolsService,
    private readonly plans: StudyPlansService,
  ) {}

  private async timezone(tenantId: string): Promise<string> {
    const settings = await this.schools.getResolvedSettings(tenantId);
    return settings.region?.timezone ?? 'UTC';
  }

  private async today(tenantId: string): Promise<string> {
    return localToday(await this.timezone(tenantId));
  }

  private async rangeOf(
    tenantId: string,
    yearId: string,
    termId: string | null,
  ): Promise<Range | null> {
    const row = termId
      ? await this.termRepo.findOne({ where: { id: termId, tenant_id: tenantId } })
      : await this.yearRepo.findOne({ where: { id: yearId, tenant_id: tenantId } });
    return row ? { from: isoDate(row.start_date), to: isoDate(row.end_date) } : null;
  }

  private async sequences(tenantId: string): Promise<Map<string, number>> {
    const slots = await this.periodSlotRepo.find({ where: { tenant_id: tenantId } });
    return new Map(slots.map((s) => [s.id, s.sequence]));
  }

  /** One resolver call: PUBLISHED routines only (the attendance trick). */
  private resolve(tenantId: string, sectionId: string, r: Range): Promise<ResolvedSlot[]> {
    return this.resolver.resolveRoutine(
      { section_id: sectionId, from: r.from, to: r.to },
      tenantId,
      {
        role: UserRole.STUDENT,
        userId: '',
      },
    );
  }

  private deliveries(tenantId: string, sectionId: string, r: Range): Promise<LessonDelivery[]> {
    return this.deliveryRepo.find({
      where: { tenant_id: tenantId, section_id: sectionId, date: Between(r.from, r.to) },
    });
  }

  private async hasPublishedRoutine(tenantId: string, yearId: string): Promise<boolean> {
    return !!(await this.routineRepo.findOne({
      where: {
        tenant_id: tenantId,
        academic_year_id: yearId,
        state: RoutineState.PUBLISHED,
        deleted_at: IsNull(),
      },
      select: { id: true },
    }));
  }

  /** A plan whose term/year is gone: zero counts, flagged like a missing routine. */
  private emptySummary(lessonsTotal: number): PlanSummaryDto {
    return {
      lessons_done: 0,
      lessons_total: lessonsTotal,
      periods_behind: 0,
      lessons_behind: 0,
      unreported_periods: 0,
      unreported_school_days: 0,
      oldest_unreported_date: null,
      last_reported_at: null,
      capacity: { periods_left: 0, periods_needed: 0, fits: true },
      routine_missing: true,
    };
  }

  private summaryOf(
    r: MapResult,
    lastReportedAt: string | null,
    routineMissing: boolean,
  ): PlanSummaryDto {
    return {
      lessons_done: r.lessons_done,
      lessons_total: r.lessons_total,
      periods_behind: r.periods_behind,
      lessons_behind: r.lessons_behind,
      unreported_periods: r.unreported.periods,
      unreported_school_days: r.unreported.school_days,
      oldest_unreported_date: r.unreported.oldest_date,
      last_reported_at: lastReportedAt,
      capacity: r.capacity,
      routine_missing: routineMissing,
    };
  }

  /** `MAX(updated_at)` of human-written rows per section x subject (D44), tenant-scoped. */
  private async lastReported(tenantId: string, sectionIds: string[]): Promise<Map<string, string>> {
    if (!sectionIds.length) return new Map();
    const rows: { section_id: string; subject_id: string; last: Date }[] = await this.deliveryRepo
      .createQueryBuilder('d')
      .select('d.section_id', 'section_id')
      .addSelect('d.subject_id', 'subject_id')
      .addSelect('MAX(d.updated_at)', 'last')
      .where('d.tenant_id = :tenantId AND d.auto = false AND d.section_id IN (:...sectionIds)', {
        tenantId,
        sectionIds,
      })
      .groupBy('d.section_id')
      .addGroupBy('d.subject_id')
      .getRawMany();
    return new Map(
      rows.map((r) => [`${r.section_id}|${r.subject_id}`, new Date(r.last).toISOString()]),
    );
  }

  /** Map one plan scope given pre-fetched section data. */
  private mapScope(
    scope: Scope,
    range: Range,
    today: string,
    occurrences: ResolvedSlot[],
    deliveries: LessonDelivery[],
    periodSequence: Map<string, number>,
    planStart?: string,
  ): MapResult {
    return mapLessonsToPeriods({
      lessons: scope.lessons,
      subjectId: scope.subject_id,
      occurrences: occurrences.filter((o) => o.subject_id === scope.subject_id),
      deliveries,
      periodSequence,
      today,
      rangeStart: range.from,
      rangeEnd: range.to,
      planStart,
    });
  }

  private async loadPlan(id: string, tenantId: string): Promise<StudyPlan> {
    const plan = await this.planRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (!plan) throw new NotFoundException('Study plan not found.');
    return plan;
  }

  /** One plan's schedule; 404 when its term or year is gone. */
  async scheduleFor(plan: StudyPlan, tenantId: string): Promise<PlanSchedule> {
    const sched = (await this.schedulesFor([plan], tenantId)).get(plan.id);
    if (!sched) throw new NotFoundException('The plan term or year no longer exists.');
    return sched;
  }

  /** Controller entry: read check, then the schedule (no `raw` leaks out). */
  async getSchedule(
    id: string,
    tenantId: string,
    caller: StudyPlanCaller,
  ): Promise<PlanScheduleResponseDto> {
    const plan = await this.loadPlan(id, tenantId);
    await this.plans.assertCanRead(caller, plan);
    const { raw: _raw, ...res } = await this.scheduleFor(plan, tenantId);
    return res;
  }

  /** Summaries for many plans; a plan whose term/year is gone gets an empty one. */
  async summarize(plans: StudyPlan[], tenantId: string): Promise<Map<string, PlanSummaryDto>> {
    const scheds = await this.schedulesFor(plans, tenantId);
    return new Map(
      plans.map((p) => [p.id, scheds.get(p.id)?.summary ?? this.emptySummary(p.lessons.length)]),
    );
  }

  /**
   * Schedules for many plans. One resolver call and one delivery query per
   * section x year, reused for every plan of that section. A plan whose
   * term/year is gone is left out of the map.
   */
  async schedulesFor(plans: StudyPlan[], tenantId: string): Promise<Map<string, PlanSchedule>> {
    const out = new Map<string, PlanSchedule>();
    if (!plans.length) return out;
    const [tz, periodSequence, last] = await Promise.all([
      this.timezone(tenantId),
      this.sequences(tenantId),
      this.lastReported(tenantId, [...new Set(plans.map((p) => p.section_id))]),
    ]);
    const today = localToday(tz);

    const ranges = new Map<string, Range | null>();
    for (const p of plans) {
      const rk = `${p.academic_year_id}|${p.academic_term_id ?? ''}`;
      if (!ranges.has(rk)) {
        ranges.set(rk, await this.rangeOf(tenantId, p.academic_year_id, p.academic_term_id));
      }
    }
    const routineByYear = new Map<string, boolean>();
    for (const y of new Set(plans.map((p) => p.academic_year_id))) {
      routineByYear.set(y, await this.hasPublishedRoutine(tenantId, y));
    }

    // Group by section x year; the resolver reads the routine of the year covering `from`.
    const groups = new Map<string, StudyPlan[]>();
    for (const p of plans) {
      const g = `${p.section_id}|${p.academic_year_id}`;
      groups.set(g, [...(groups.get(g) ?? []), p]);
    }
    for (const group of groups.values()) {
      const rs = group.map((p) => ranges.get(`${p.academic_year_id}|${p.academic_term_id ?? ''}`));
      const valid = rs.filter((r): r is Range => !!r);
      if (!valid.length) continue;
      const union: Range = {
        from: valid.reduce((m, r) => (r.from < m ? r.from : m), valid[0].from),
        to: valid.reduce((m, r) => (r.to > m ? r.to : m), valid[0].to),
      };
      const sectionId = group[0].section_id;
      const [occurrences, deliveries] = await Promise.all([
        this.resolve(tenantId, sectionId, union),
        this.deliveries(tenantId, sectionId, union),
      ]);
      for (const p of group) {
        const range = ranges.get(`${p.academic_year_id}|${p.academic_term_id ?? ''}`);
        if (!range) continue;
        const raw = this.mapScope(
          p,
          range,
          today,
          occurrences,
          deliveries,
          periodSequence,
          // D1 floor: the plan's creation day in school time (#2036 review 1).
          p.created_at ? localDate(new Date(p.created_at), tz) : undefined,
        );
        out.set(p.id, {
          range,
          today,
          periods: raw.periods,
          lessons: raw.lessons,
          summary: this.summaryOf(
            raw,
            last.get(`${p.section_id}|${p.subject_id}`) ?? null,
            !routineByYear.get(p.academic_year_id) || occurrences.length === 0,
          ),
          raw,
        });
      }
    }
    return out;
  }

  /** D41: periods of a section x subject x term before any plan exists. */
  async capacityFor(
    tenantId: string,
    sectionId: string,
    subjectId: string,
    termId: string | null,
  ): Promise<PlanCapacityResponseDto> {
    const year = await this.sectionYearId(tenantId, sectionId);
    if (year && termId) {
      const term = await this.termRepo.findOne({ where: { id: termId, tenant_id: tenantId } });
      if (term && term.academic_year_id !== year) {
        throw new BadRequestException({
          message: 'The term does not belong to the section year.',
          details: { code: 'STUDY_PLAN_TERM_YEAR_MISMATCH' },
        });
      }
    }
    const range = year ? await this.rangeOf(tenantId, year, termId) : null;
    if (!range) throw new NotFoundException('Section or term not found.');
    const [today, periodSequence, occurrences, deliveries] = await Promise.all([
      this.today(tenantId),
      this.sequences(tenantId),
      this.resolve(tenantId, sectionId, range),
      this.deliveries(tenantId, sectionId, range),
    ]);
    const r = this.mapScope(
      { subject_id: subjectId, lessons: [] },
      range,
      today,
      occurrences,
      deliveries,
      periodSequence,
    );
    return {
      periods_total: r.periods.filter((p) => p.kind === 'ROUTINE' && p.status !== 'EXCLUDED')
        .length,
      periods_left: r.capacity.periods_left,
      range,
    };
  }

  /** Controller entry for `GET /study-plans/capacity`: tenant-wide staff or a writer of that scope. */
  async capacityForCaller(
    tenantId: string,
    caller: StudyPlanCaller,
    sectionId: string,
    subjectId: string,
    termId: string | null,
  ): Promise<PlanCapacityResponseDto> {
    const year = await this.sectionYearId(tenantId, sectionId);
    if (!year) throw new NotFoundException('Section not found.');
    if (!hasTenantDataScope(caller.role)) {
      await this.plans.assertCanWrite(caller, sectionId, subjectId, year);
    }
    return this.capacityFor(tenantId, sectionId, subjectId, termId);
  }

  private async sectionYearId(tenantId: string, sectionId: string): Promise<string | null> {
    const rows: { year_id: string }[] = await this.planRepo.manager.query(
      `SELECT c.academic_year_id AS year_id
         FROM class_sections cs
         JOIN classes c ON c.id = cs.class_id AND c.tenant_id = $1 AND c.deleted_at IS NULL
        WHERE cs.id = $2 AND cs.tenant_id = $1 AND cs.deleted_at IS NULL`,
      [tenantId, sectionId],
    );
    return rows[0]?.year_id ?? null;
  }

  /** D27: lessons not done yet, with fresh ids, for the next term's plan. */
  async carryOver(
    id: string,
    tenantId: string,
    caller: StudyPlanCaller,
  ): Promise<CarryOverResponseDto> {
    const plan = await this.loadPlan(id, tenantId);
    await this.plans.assertCanRead(caller, plan);
    const { raw } = await this.scheduleFor(plan, tenantId);
    const unfinished = new Set(raw.lessons.filter((l) => l.status !== 'DONE').map((l) => l.id));
    const term = plan.academic_term_id
      ? await this.termRepo.findOne({
          where: { id: plan.academic_term_id, tenant_id: tenantId },
          withDeleted: true,
        })
      : null;
    return {
      lessons: plan.lessons
        .filter((l) => unfinished.has(l.id))
        .map((l) => ({
          id: randomUUID(),
          title: l.title,
          periods: l.periods,
          ...(l.topic_id ? { topic_id: l.topic_id } : {}),
          ...(l.notes ? { notes: l.notes } : {}),
        })),
      from_term: term ? { id: term.id, name: term.name } : null,
    };
  }

  /**
   * `GET /study-plans` with summaries. Without `behind`/`sort` it pages as the
   * base list does; with them it pulls the whole filtered, caller-visible set.
   * ponytail: in-memory sort of <= a few hundred plans; materialise if a school passes ~1000 plans.
   */
  async listWithSummary(
    query: ListStudyPlansWithSummaryQueryDto,
    tenantId: string,
    caller: StudyPlanCaller,
  ) {
    const { behind, sort, order, ...base } = query;
    const page = base.page ?? 1;
    const limit = base.limit ?? 20;
    const computed = !!behind || !!sort;

    let rows: StudyPlanBaseDto[];
    let total: number;
    if (!computed) {
      const res = await this.plans.findAll(base, tenantId, caller);
      rows = res.data;
      total = res.total;
    } else {
      // One unpaged call: a teacher's visibility scan runs once, not once per 100-row page.
      rows = (
        await this.plans.findAll(
          { ...base, page: 1, limit: Number.MAX_SAFE_INTEGER },
          tenantId,
          caller,
        )
      ).data;
      total = rows.length;
    }

    const entities = rows.length
      ? await this.planRepo.find({ where: rows.map((r) => ({ id: r.id, tenant_id: tenantId })) })
      : [];
    const summaries = await this.summarize(entities, tenantId);
    let withSummary = rows.flatMap((r) => {
      const summary = summaries.get(r.id);
      return summary ? [{ ...r, summary }] : [];
    });

    if (behind) {
      withSummary = withSummary.filter(
        (r) => r.summary.lessons_behind >= 1 || r.summary.periods_behind > 0,
      );
    }
    if (sort) {
      const dir = order === 'desc' ? -1 : 1;
      const val = (r: (typeof withSummary)[number]): number | string =>
        sort === 'behind_periods'
          ? r.summary.periods_behind
          : sort === 'section'
            ? `${r.section.class_name} ${r.section.name}`
            : r.subject.name_en;
      withSummary.sort((a, b) => {
        const x = val(a);
        const y = val(b);
        return (x < y ? -1 : x > y ? 1 : 0) * dir;
      });
    }
    if (computed) {
      total = withSummary.length;
      withSummary = withSummary.slice((page - 1) * limit, page * limit);
    }
    return { data: withSummary, total, page, limit, totalPages: Math.ceil(total / limit) };
  }
}
