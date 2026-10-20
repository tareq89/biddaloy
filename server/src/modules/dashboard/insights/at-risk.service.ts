import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Queue } from 'bullmq';
import type Redis from 'ioredis';
import { DataSource } from 'typeorm';
import { AttendanceStatus, DashboardRiskThresholds } from '@biddaloy/shared';
import { AttendanceSummaryService } from '../../attendance/attendance-summary.service';
import { sectionRosterIdsBySection } from '../../enrollments/section-roster';
import { OPEN_FEE_STATUSES } from '../../fees/fees.constants';
import { SchoolsService } from '../../schools/schools.service';
import { TENANT_STATUS_REDIS } from '../../schools/tenant-status.service';
import { DEFAULT_DASHBOARD_SETTINGS } from '../../schools/settings/tenant-settings-defaults';
import {
  AT_RISK_IDS_TTL_SECONDS,
  AT_RISK_LIST_TTL_SECONDS,
  AT_RISK_QUEUE,
  AT_RISK_TENANT_JOB,
} from './at-risk.constants';
import type {
  AtRiskSignalDto,
  AtRiskStudentDto,
  AtRiskStudentsWidgetDto,
} from './dto/at-risk-students-widget.dto';

/** A student must meet this many of the 4 signals to be listed (D7). */
const MIN_SIGNALS = 2;
/** Rolling window for LOW_ATTENDANCE: today and the 29 days before it. */
const ATTENDANCE_WINDOW_DAYS = 30;

interface StoredList {
  computed_at: string;
  date: string;
  thresholds: DashboardRiskThresholds;
  students: AtRiskStudentDto[];
}

const sameThresholds = (a: DashboardRiskThresholds, b: DashboardRiskThresholds): boolean =>
  a.absentStreakDays === b.absentStreakDays &&
  a.monthlyAttendancePct === b.monthlyAttendancePct &&
  a.failedSubjects === b.failedSubjects &&
  a.overdueDays === b.overdueDays;

function addDays(dateIso: string, days: number): string {
  const d = new Date(`${dateIso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * "At-risk students" widget: students on the roll today (current academic year) who meet at
 * least 2 of 4 signals. Computed nightly (and on demand) into Redis; the request path only
 * reads it. Each signal reuses its owner's query so the numbers reconcile with those screens.
 */
@Injectable()
export class AtRiskService {
  private readonly logger = new Logger(AtRiskService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectQueue(AT_RISK_QUEUE) private readonly queue: Queue,
    @Inject(TENANT_STATUS_REDIS) private readonly redis: Redis,
    private readonly schools: SchoolsService,
    private readonly attendance: AttendanceSummaryService,
  ) {}

  listKey(tenantId: string): string {
    return `tenant:${tenantId}:dash:v1:at-risk-students:list`;
  }

  idsKey(tenantId: string, date: string): string {
    return `tenant:${tenantId}:dash:v1:at-risk-students:ids:${date}`;
  }

  private async thresholdsFor(tenantId: string): Promise<DashboardRiskThresholds> {
    const settings = await this.schools.getResolvedSettings(tenantId);
    return { ...DEFAULT_DASHBOARD_SETTINGS.risk, ...settings.dashboard?.risk };
  }

  /** Read path: cached value only. Missing or stale -> enqueue one recompute (deduped by jobId). */
  async read(tenantId: string, limit: number): Promise<AtRiskStudentsWidgetDto> {
    const thresholds = await this.thresholdsFor(tenantId);
    let stored: StoredList | null = null;
    try {
      const raw = await this.redis.get(this.listKey(tenantId));
      stored = raw ? (JSON.parse(raw) as StoredList) : null;
    } catch (error) {
      this.logger.error(`At-risk cache read failed for ${tenantId}: ${String(error)}`);
    }

    const stale = stored !== null && !sameThresholds(stored.thresholds, thresholds);
    if (stored === null || stale) await this.enqueueRefresh(tenantId);
    if (stored === null) {
      return {
        state: 'COMPUTING',
        computed_at: null,
        stale: false,
        thresholds,
        total: 0,
        week_ago_total: null,
        new_this_week: null,
        students: [],
      };
    }

    let weekAgoIds: string[] | null = null;
    try {
      const raw = await this.redis.get(this.idsKey(tenantId, addDays(stored.date, -7)));
      weekAgoIds = raw ? (JSON.parse(raw) as string[]) : null;
    } catch (error) {
      this.logger.error(`At-risk cache read failed for ${tenantId}: ${String(error)}`);
    }
    const before = weekAgoIds ? new Set(weekAgoIds) : null;
    return {
      state: 'READY',
      computed_at: stored.computed_at,
      stale,
      thresholds: stored.thresholds,
      total: stored.students.length,
      week_ago_total: before ? before.size : null,
      new_this_week: before
        ? stored.students.filter((s) => !before.has(s.student_id)).length
        : null,
      students: stored.students.slice(0, limit),
    };
  }

  private async enqueueRefresh(tenantId: string): Promise<void> {
    try {
      await this.queue.add(
        AT_RISK_TENANT_JOB,
        { tenantId },
        {
          jobId: `at-risk-students-${tenantId}`,
          removeOnComplete: true,
          // A kept failed job would hold this jobId and BullMQ would ignore every later add.
          removeOnFail: true,
        },
      );
    } catch (error) {
      this.logger.error(`At-risk enqueue failed for ${tenantId}: ${String(error)}`);
    }
  }

  /** Compute and store both cache keys (job path). */
  async refresh(tenantId: string): Promise<void> {
    const thresholds = await this.thresholdsFor(tenantId);
    const date = await this.schools.todayFor(tenantId);
    const students = await this.compute(tenantId, date, thresholds);
    const list: StoredList = { computed_at: new Date().toISOString(), date, thresholds, students };
    try {
      await this.redis.set(
        this.idsKey(tenantId, date),
        JSON.stringify(students.map((s) => s.student_id)),
        'EX',
        AT_RISK_IDS_TTL_SECONDS,
      );
      await this.redis.set(
        this.listKey(tenantId),
        JSON.stringify(list),
        'EX',
        AT_RISK_LIST_TTL_SECONDS,
      );
    } catch (error) {
      this.logger.error(`At-risk cache write failed for ${tenantId}: ${String(error)}`);
    }
  }

  /** Students with >= 2 signals, most signals first, then name. */
  async compute(
    tenantId: string,
    today: string,
    t: DashboardRiskThresholds,
  ): Promise<AtRiskStudentDto[]> {
    // On the roll today, current academic year (enrollment-based, same rule as the register).
    const sections = (await this.dataSource.query(
      `SELECT cs.id, cs.section_name, c.id AS class_id, c.name AS class_name
         FROM class_sections cs
         JOIN classes c ON c.id = cs.class_id AND c.deleted_at IS NULL
         JOIN academic_years y ON y.id = c.academic_year_id AND y.is_current = true AND y.deleted_at IS NULL
        WHERE cs.tenant_id = $1 AND cs.deleted_at IS NULL`,
      [tenantId],
    )) as { id: string; section_name: string; class_id: string; class_name: string }[];
    if (sections.length === 0) return [];
    const rosters = await sectionRosterIdsBySection(
      this.dataSource.manager,
      tenantId,
      sections.map((s) => s.id),
      { onRollOn: today },
    );
    const roster = new Map<string, { section: (typeof sections)[number] }>();
    for (const section of sections) {
      for (const id of rosters.get(section.id) ?? []) roster.set(id, { section });
    }
    if (roster.size === 0) return [];
    const ids = [...roster.keys()];

    const names = (await this.dataSource.query(
      `SELECT id, full_name FROM students WHERE tenant_id = $1 AND id = ANY($2) AND deleted_at IS NULL`,
      [tenantId, ids],
    )) as { id: string; full_name: string }[];
    const nameOf = new Map(names.map((n) => [n.id, n.full_name]));

    const signals = new Map<string, AtRiskSignalDto[]>();
    const add = (studentId: string, signal: AtRiskSignalDto) => {
      if (!roster.has(studentId)) return; // not on today's current-year roll
      signals.set(studentId, [...(signals.get(studentId) ?? []), signal]);
    };

    // ponytail: per-section loop in the nightly job only; one SQL if the sweep gets slow.
    for (const section of sections) {
      const { items } = await this.attendance.getSectionStreaks({
        tenantId,
        sectionId: section.id,
        absentThreshold: t.absentStreakDays,
      });
      for (const s of items) {
        if (s.status === AttendanceStatus.ABSENT)
          add(s.student_id, { kind: 'ABSENT_STREAK', value: s.length });
      }
    }

    const low = await this.attendance.getLowAttendanceFlags({
      tenantId,
      from: addDays(today, -(ATTENDANCE_WINDOW_DAYS - 1)),
      to: today,
      thresholdPercent: t.monthlyAttendancePct,
      page: 1,
      limit: Number.MAX_SAFE_INTEGER, // one grouped pass; paging would recompute every page
    });
    for (const row of low.data) {
      add(row.student_id, { kind: 'LOW_ATTENDANCE', value: row.attendance_percentage as number });
    }

    // Failed subjects in the latest PUBLISHED exam of the student's current class (D19).
    const failed = (await this.dataSource.query(
      `WITH latest AS (
         SELECT DISTINCT ON (e.class_id) e.id, e.class_id
           FROM exams e
          WHERE e.tenant_id = $1 AND e.status = 'PUBLISHED' AND e.deleted_at IS NULL
          ORDER BY e.class_id, e.published_at DESC NULLS LAST
       )
       SELECT r.student_id, l.class_id, sub.name_en, sub.name_bn
         FROM latest l
         JOIN results r ON r.exam_id = l.id AND r.tenant_id = $1 AND r.deleted_at IS NULL
         JOIN result_subjects rs ON rs.result_id = r.id AND rs.tenant_id = $1 AND rs.deleted_at IS NULL
         JOIN subjects sub ON sub.id = rs.subject_id
        WHERE rs.is_fail = true AND rs.is_fourth_subject = false AND r.student_id = ANY($2)
        ORDER BY sub.name_en`,
      [tenantId, ids],
    )) as { student_id: string; class_id: string; name_en: string; name_bn: string | null }[];
    const failedBy = new Map<string, { name_en: string; name_bn: string | null }[]>();
    for (const row of failed) {
      if (roster.get(row.student_id)?.section.class_id !== row.class_id) continue;
      failedBy.set(row.student_id, [
        ...(failedBy.get(row.student_id) ?? []),
        { name_en: row.name_en, name_bn: row.name_bn },
      ]);
    }
    for (const [studentId, subjects] of failedBy) {
      if (subjects.length >= t.failedSubjects)
        add(studentId, { kind: 'FAILED_SUBJECTS', value: subjects.length, subjects });
    }

    // Oldest open bill past due. student_fees has no tenant_id: scope through students.
    const overdue = (await this.dataSource.query(
      `SELECT sf.student_id, ($2::date - MIN(sf.due_date)::date) AS days
         FROM student_fees sf
         JOIN students s ON s.id = sf.student_id
        WHERE s.tenant_id = $1 AND sf.deleted_at IS NULL AND sf.status = ANY($3)
          AND sf.due_date IS NOT NULL AND sf.due_date < $2::date AND sf.student_id = ANY($4)
        GROUP BY sf.student_id
       HAVING ($2::date - MIN(sf.due_date)::date) >= $5`,
      [tenantId, today, OPEN_FEE_STATUSES, ids, t.overdueDays],
    )) as { student_id: string; days: number | string }[];
    for (const row of overdue) add(row.student_id, { kind: 'OVERDUE', value: Number(row.days) });

    return [...signals]
      .filter(([, list]) => list.length >= MIN_SIGNALS)
      .map(([studentId, list]) => {
        const { section } = roster.get(studentId)!;
        return {
          student_id: studentId,
          full_name: nameOf.get(studentId) ?? '',
          class_name: section.class_name,
          section_name: section.section_name,
          signals: list,
        };
      })
      .sort(
        (a, b) => b.signals.length - a.signals.length || a.full_name.localeCompare(b.full_name),
      );
  }
}
