import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AttendancePolicySettings, AttendanceStatus } from '@biddaloy/shared';
import { AttendanceRecord } from './entities/attendance-record.entity';
import { Student } from '../students/entities/student.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { SchoolCalendarService } from '../academics/school-calendar.service';
import { SchoolsService } from '../schools/schools.service';
import { resolveAttendancePolicy } from './attendance-policy.util';

/** Same UTC-epoch-day arithmetic as `school-calendar.service.ts` —
 * duplicated rather than imported for the same reason that file's own
 * comment gives: this is a small, private helper and the two modules
 * shouldn't share a non-public dependency just to avoid four lines. */
function toEpochDay(dateIso: string): number {
  const [year, month, day] = dateIso.split('-').map(Number);
  return Date.UTC(year, month - 1, day) / (24 * 60 * 60 * 1000);
}

function epochDayToIso(epochDay: number): string {
  const ms = epochDay * 24 * 60 * 60 * 1000;
  const d = new Date(ms);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function everyDateInRange(from: string, to: string): string[] {
  const fromDay = toEpochDay(from);
  const toDay = toEpochDay(to);
  const dates: string[] = [];
  for (let day = fromDay; day <= toDay; day++) {
    dates.push(epochDayToIso(day));
  }
  return dates;
}

/**
 * A single student's attendance counts and derived percentage over one
 * date range.
 *
 * **This interface is a contract with a future exam module.** Adding a key
 * is allowed. Renaming or removing one is a breaking change that must be
 * raised with the user first. `attendance-summary.contract.spec.ts` asserts
 * the exact key set so the change cannot be accidental.
 */
export interface AttendanceSummary {
  student_id: string;
  from: string;
  to: string;
  working_days: number;
  marked_days: number;
  present_days: number;
  late_days: number;
  absent_days: number;
  leave_days: number;
  unmarked_days: number;
  attendance_percentage: number | null;
  policy: {
    late_counts_as_present: boolean;
    leave_counts_as_working_day: boolean;
    denominator: 'WORKING_DAYS' | 'MARKED_DAYS';
  };
}

interface StatusCounts {
  present_days: number;
  late_days: number;
  absent_days: number;
  leave_days: number;
}

function emptyStatusCounts(): StatusCounts {
  return { present_days: 0, late_days: 0, absent_days: 0, leave_days: 0 };
}

/**
 * The formula, stated once. `counts.working_days`/`counts.marked_days` are
 * whichever the tenant's `percentageDenominator` selects; the caller
 * decides which one to pass as `denominatorDays` — this function has no
 * database dependency, so the contract test can hammer it directly.
 *
 * Returns `null`, never `0`, when there is nothing to divide by — a school
 * that has marked nothing must not read as "0% attendance" to an exam
 * eligibility rule.
 */
export function computeAttendancePercentage(
  counts: StatusCounts & { working_days: number; marked_days: number },
  policy: Pick<
    AttendancePolicySettings,
    'percentageDenominator' | 'leaveCountsAsWorkingDay' | 'lateCountsAsPresent'
  >,
): number | null {
  let denominator =
    policy.percentageDenominator === 'MARKED_DAYS' ? counts.marked_days : counts.working_days;
  if (!policy.leaveCountsAsWorkingDay) {
    denominator -= counts.leave_days;
  }
  if (denominator <= 0) {
    return null;
  }
  const numerator = counts.present_days + (policy.lateCountsAsPresent ? counts.late_days : 0);
  return Math.round((numerator / denominator) * 100 * 100) / 100;
}

/**
 * The single source of truth for "what is this student's attendance
 * percentage" — every read endpoint below composes on top of the same
 * counting logic, so no two surfaces of the product can ever disagree
 * about what a percentage means. See the epic (#379) and [9.4]'s plan for
 * why this had to be exactly one implementation.
 */
@Injectable()
export class AttendanceSummaryService {
  constructor(
    @InjectRepository(AttendanceRecord)
    private readonly recordRepo: Repository<AttendanceRecord>,
    @InjectRepository(Student)
    private readonly studentRepo: Repository<Student>,
    @InjectRepository(ClassSection)
    private readonly sectionRepo: Repository<ClassSection>,
    private readonly schoolCalendarService: SchoolCalendarService,
    private readonly schoolsService: SchoolsService,
  ) {}

  private async getPolicy(tenantId: string): Promise<AttendancePolicySettings> {
    const settings = await this.schoolsService.getResolvedSettings(tenantId);
    return resolveAttendancePolicy(settings);
  }

  /**
   * Bulk building block every method below composes on. Issues exactly
   * **two** grouped queries regardless of how many student ids are passed
   * — never loop this per student. A 60-student section summary is O(1)
   * queries, not O(n); a reviewer who "simplifies" this into a per-student
   * loop is reintroducing the N+1 this ticket exists to prevent.
   */
  private async computeSummaries(
    tenantId: string,
    studentIds: string[],
    from: string,
    to: string,
  ): Promise<{
    summaries: Map<string, AttendanceSummary>;
    workingDays: string[];
    workingDaysCount: number;
  }> {
    const policy = await this.getPolicy(tenantId);
    const workingDays = await this.schoolCalendarService.getWorkingDays({ tenantId, from, to });

    const summaries = new Map<string, AttendanceSummary>();
    if (studentIds.length === 0) {
      return { summaries, workingDays: workingDays.dates, workingDaysCount: workingDays.count };
    }

    // Query 1: per-status counts, restricted to working days. This is the
    // query [9.4]'s plan asks to `EXPLAIN ANALYZE` against the
    // `(tenant_id, student_id, date)` index from [9.2] — see the PR
    // description. Must share the same working-day filter as query 2 below:
    // a PRESENT/LATE record forced onto a holiday (via a correction) would
    // otherwise inflate the numerator without adding to either denominator
    // candidate, pushing attendance_percentage above 100%.
    const statusRows: Array<{ student_id: string; status: AttendanceStatus; count: string }> =
      workingDays.dates.length === 0
        ? []
        : await this.recordRepo
            .createQueryBuilder('r')
            .select('r.student_id', 'student_id')
            .addSelect('r.status', 'status')
            .addSelect('COUNT(*)', 'count')
            .where('r.tenant_id = :tenantId', { tenantId })
            .andWhere('r.date = ANY(:workingDates)', { workingDates: workingDays.dates })
            .andWhere('r.student_id IN (:...studentIds)', { studentIds })
            .groupBy('r.student_id')
            .addGroupBy('r.status')
            .getRawMany();

    // Query 2: marked_days — distinct dates with a record for the student,
    // counted only on working days (per the plan: a forced correction on a
    // non-working day must not inflate the denominator).
    const markedRows: Array<{ student_id: string; marked_days: string }> =
      workingDays.dates.length === 0
        ? []
        : await this.recordRepo
            .createQueryBuilder('r')
            .select('r.student_id', 'student_id')
            .addSelect('COUNT(DISTINCT r.date)', 'marked_days')
            .where('r.tenant_id = :tenantId', { tenantId })
            .andWhere('r.date = ANY(:workingDates)', { workingDates: workingDays.dates })
            .andWhere('r.student_id IN (:...studentIds)', { studentIds })
            .groupBy('r.student_id')
            .getRawMany();

    const countsByStudent = new Map<string, StatusCounts>();
    for (const id of studentIds) {
      countsByStudent.set(id, emptyStatusCounts());
    }
    for (const row of statusRows) {
      const counts = countsByStudent.get(row.student_id);
      if (!counts) continue;
      const count = Number(row.count);
      switch (row.status) {
        case AttendanceStatus.PRESENT:
          counts.present_days = count;
          break;
        case AttendanceStatus.LATE:
          counts.late_days = count;
          break;
        case AttendanceStatus.ABSENT:
          counts.absent_days = count;
          break;
        case AttendanceStatus.LEAVE:
          counts.leave_days = count;
          break;
      }
    }

    const markedByStudent = new Map<string, number>(
      markedRows.map((r) => [r.student_id, Number(r.marked_days)]),
    );

    for (const studentId of studentIds) {
      const counts = countsByStudent.get(studentId)!;
      const markedDays = markedByStudent.get(studentId) ?? 0;
      const unmarkedDays = Math.max(0, workingDays.count - markedDays);
      const percentage = computeAttendancePercentage(
        { ...counts, working_days: workingDays.count, marked_days: markedDays },
        policy,
      );

      summaries.set(studentId, {
        student_id: studentId,
        from,
        to,
        working_days: workingDays.count,
        marked_days: markedDays,
        present_days: counts.present_days,
        late_days: counts.late_days,
        absent_days: counts.absent_days,
        leave_days: counts.leave_days,
        unmarked_days: unmarkedDays,
        attendance_percentage: percentage,
        policy: {
          late_counts_as_present: policy.lateCountsAsPresent,
          leave_counts_as_working_day: policy.leaveCountsAsWorkingDay,
          denominator: policy.percentageDenominator,
        },
      });
    }

    return { summaries, workingDays: workingDays.dates, workingDaysCount: workingDays.count };
  }

  private async assertStudentExists(tenantId: string, studentId: string): Promise<void> {
    const exists = await this.studentRepo.exist({ where: { id: studentId, tenant_id: tenantId } });
    if (!exists) {
      throw new NotFoundException('Student not found');
    }
  }

  async getStudentSummary(input: {
    tenantId: string;
    studentId: string;
    from: string;
    to: string;
  }): Promise<AttendanceSummary> {
    const { tenantId, studentId, from, to } = input;
    await this.assertStudentExists(tenantId, studentId);
    const { summaries } = await this.computeSummaries(tenantId, [studentId], from, to);
    return summaries.get(studentId)!;
  }

  async getStudentDays(input: {
    tenantId: string;
    studentId: string;
    from: string;
    to: string;
  }): Promise<
    Array<{
      date: string;
      status: AttendanceStatus | null;
      minutes_late: number | null;
      remarks: string | null;
      is_working_day: boolean;
      holiday_name: string | null;
    }>
  > {
    const { tenantId, studentId, from, to } = input;
    await this.assertStudentExists(tenantId, studentId);

    const workingDays = await this.schoolCalendarService.getWorkingDays({ tenantId, from, to });
    const workingDaySet = new Set(workingDays.dates);

    const records = await this.recordRepo.find({
      where: { tenant_id: tenantId, student_id: studentId, date: In(everyDateInRange(from, to)) },
    });
    const recordByDate = new Map(records.map((r) => [r.date, r]));

    // Bounded by MAX_RANGE_DAYS (400) via `listHolidays`'s own guard rails —
    // a day-list request spans at most one date range, same as
    // `getWorkingDays`'s own range.
    const { data: holidays } = await this.schoolCalendarService.listHolidays(
      { from, to, page: 1, limit: 400 },
      tenantId,
    );
    const holidayNameByDate = new Map<string, string>();
    for (const holiday of holidays) {
      const start = Math.max(toEpochDay(holiday.start_date), toEpochDay(from));
      const end = Math.min(toEpochDay(holiday.end_date), toEpochDay(to));
      for (let day = start; day <= end; day++) {
        holidayNameByDate.set(epochDayToIso(day), holiday.name);
      }
    }

    return everyDateInRange(from, to).map((date) => {
      const record = recordByDate.get(date) ?? null;
      return {
        date,
        status: record?.status ?? null,
        minutes_late: record?.minutes_late ?? null,
        remarks: record?.remarks ?? null,
        is_working_day: workingDaySet.has(date),
        holiday_name: holidayNameByDate.get(date) ?? null,
      };
    });
  }

  async getSectionSummary(input: {
    tenantId: string;
    sectionId: string;
    from: string;
    to: string;
  }): Promise<{
    section_id: string;
    from: string;
    to: string;
    working_days: number;
    students: AttendanceSummary[];
    section_percentage: number | null;
  }> {
    const { tenantId, sectionId, from, to } = input;
    const students = await this.studentRepo.find({
      where: { tenant_id: tenantId, class_section_id: sectionId },
      order: { roll_number: 'ASC' },
    });
    const studentIds = students.map((s) => s.id);
    const { summaries, workingDaysCount } = await this.computeSummaries(
      tenantId,
      studentIds,
      from,
      to,
    );
    const studentSummaries = students.map((s) => summaries.get(s.id)!);

    const nonNullPercentages = studentSummaries
      .map((s) => s.attendance_percentage)
      .filter((p): p is number => p !== null);
    const sectionPercentage =
      nonNullPercentages.length === 0
        ? null
        : Math.round(
            (nonNullPercentages.reduce((sum, p) => sum + p, 0) / nonNullPercentages.length) * 100,
          ) / 100;

    return {
      section_id: sectionId,
      from,
      to,
      working_days: workingDaysCount,
      students: studentSummaries,
      section_percentage: sectionPercentage,
    };
  }

  async getSectionRegisterMatrix(input: {
    tenantId: string;
    sectionId: string;
    from: string;
    to: string;
  }): Promise<{
    dates: Array<{ date: string; is_working_day: boolean }>;
    rows: Array<{
      student_id: string;
      roll_number: number;
      full_name: string;
      marks: Record<string, AttendanceStatus | null>;
      summary: AttendanceSummary;
    }>;
  }> {
    const { tenantId, sectionId, from, to } = input;
    const students = await this.studentRepo.find({
      where: { tenant_id: tenantId, class_section_id: sectionId },
      order: { roll_number: 'ASC' },
    });
    const studentIds = students.map((s) => s.id);

    const { summaries, workingDays } = await this.computeSummaries(tenantId, studentIds, from, to);
    const workingDaySet = new Set(workingDays);
    const dates = everyDateInRange(from, to).map((date) => ({
      date,
      is_working_day: workingDaySet.has(date),
    }));

    const records =
      studentIds.length === 0
        ? []
        : await this.recordRepo.find({
            where: {
              tenant_id: tenantId,
              student_id: In(studentIds),
              date: In(everyDateInRange(from, to)),
            },
          });
    const marksByStudent = new Map<string, Map<string, AttendanceStatus>>();
    for (const record of records) {
      if (!marksByStudent.has(record.student_id)) {
        marksByStudent.set(record.student_id, new Map());
      }
      marksByStudent.get(record.student_id)!.set(record.date, record.status);
    }

    const rows = students.map((student) => {
      const studentMarks = marksByStudent.get(student.id);
      const marks: Record<string, AttendanceStatus | null> = {};
      for (const { date } of dates) {
        marks[date] = studentMarks?.get(date) ?? null;
      }
      return {
        student_id: student.id,
        roll_number: student.roll_number,
        full_name: student.full_name,
        marks,
        summary: summaries.get(student.id)!,
      };
    });

    return { dates, rows };
  }

  async getLowAttendanceFlags(input: {
    tenantId: string;
    from: string;
    to: string;
    thresholdPercent?: number;
    classId?: string;
    sectionId?: string;
    page?: number;
    limit?: number;
  }): Promise<{
    data: Array<
      AttendanceSummary & {
        student_name: string;
        roll_number: number;
        class_name: string;
        section_name: string;
        guardian_id: string | null;
      }
    >;
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const { tenantId, from, to, classId, sectionId } = input;
    const page = input.page || 1;
    const limit = input.limit || 10;

    const policy = await this.getPolicy(tenantId);
    const threshold = input.thresholdPercent ?? policy.lowAttendanceThresholdPercent;

    const qb = this.studentRepo
      .createQueryBuilder('student')
      .leftJoinAndSelect('student.class_section', 'class_section')
      .leftJoinAndSelect('class_section.class', 'class')
      .leftJoinAndSelect('student.guardians', 'guardians')
      .where('student.tenant_id = :tenantId', { tenantId });
    if (sectionId) {
      qb.andWhere('student.class_section_id = :sectionId', { sectionId });
    }
    if (classId) {
      qb.andWhere('class_section.class_id = :classId', { classId });
    }
    const students = await qb.orderBy('student.roll_number', 'ASC').getMany();

    // One grouped query for the whole matched roster, however large — see
    // `computeSummaries`'s own docstring for why this must never become a
    // per-student loop.
    const { summaries } = await this.computeSummaries(
      tenantId,
      students.map((s) => s.id),
      from,
      to,
    );

    const flagged = students
      .map((student) => {
        const summary = summaries.get(student.id)!;
        return {
          ...summary,
          student_name: student.full_name,
          roll_number: student.roll_number,
          class_name:
            (student.class_section as ClassSection & { class?: { name: string } }).class?.name ??
            '',
          section_name: student.class_section?.section_name ?? '',
          // A student can have more than one guardian; the flag list shows
          // one contact rather than fan out into multiple rows. Which one
          // is arbitrary among co-guardians — first by insertion order.
          guardian_id: student.guardians?.[0]?.id ?? null,
        };
      })
      // "we have no data" (null percentage) is not "this child is failing" —
      // a flag list full of unmarked students trains staff to ignore it.
      .filter((s) => s.attendance_percentage !== null && s.attendance_percentage < threshold);

    const total = flagged.length;
    const start = (page - 1) * limit;
    const data = flagged.slice(start, start + limit);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) || 0 };
  }
}
