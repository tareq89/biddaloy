import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  MarkEntryClassDto,
  MarkEntryProgressWidgetDto,
  MyMarkDeadlineItemDto,
  MyMarkDeadlinesDto,
} from './dto/exams-dashboard.dto';

const pct = (submitted: number, total: number) =>
  total === 0 ? 0 : Math.round((submitted / total) * 100);

const DAY_MS = 86_400_000;

/**
 * [8.10.7.2.04] Mark-entry progress per class for the exam being marked.
 * "In progress" = DRAFT, current academic year, first sitting on or before
 * today. Exams are per class, so a school-wide sitting is several exams
 * sharing a `name`; the started group with the latest first sitting wins.
 */
@Injectable()
export class ExamsDashboardService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** `today` is the school's local date (YYYY-MM-DD). */
  async getMarkEntryProgress(tenantId: string, today: string): Promise<MarkEntryProgressWidgetDto> {
    const [group] = await this.dataSource.query<
      Array<{ name: string; exam_ids: string[]; deadline: string | null; last_date: string }>
    >(
      `SELECT e.name,
              array_agg(DISTINCT e.id) AS exam_ids,
              MAX(e.mark_entry_deadline)::text AS deadline,
              MAX(es.date)::text AS last_date
       FROM exams e
       JOIN academic_years ay ON ay.id = e.academic_year_id AND ay.is_current AND ay.deleted_at IS NULL
       JOIN exam_schedules es ON es.exam_id = e.id AND es.deleted_at IS NULL
       WHERE e.tenant_id = $1 AND e.status = 'DRAFT' AND e.deleted_at IS NULL
       GROUP BY e.name
       HAVING MIN(es.date) <= $2::date
       ORDER BY MIN(es.date) DESC, e.name
       LIMIT 1`,
      [tenantId, today],
    );

    if (!group) {
      return {
        exam_name: null,
        mark_entry_deadline: null,
        exam_ended_days_ago: null,
        overall: { submitted: 0, total: 0, percentage: 0 },
        classes: [],
        lowest_class_id: null,
      };
    }

    // One statement for every class: same arithmetic as MarkGridService.progress
    // (live sections x distinct live-component subjects; SUBMITTED live pairs).
    const rows = await this.dataSource.query<
      Array<{
        exam_id: string;
        class_id: string;
        class_name: string;
        submitted: string;
        total: string;
      }>
    >(
      `SELECT e.id AS exam_id, e.class_id, c.name AS class_name,
         (SELECT COUNT(*) FROM class_sections cs
            WHERE cs.class_id = e.class_id AND cs.tenant_id = $1 AND cs.deleted_at IS NULL)
         * (SELECT COUNT(DISTINCT ec.subject_id) FROM exam_components ec
            WHERE ec.exam_id = e.id AND ec.tenant_id = $1 AND ec.deleted_at IS NULL) AS total,
         (SELECT COUNT(*) FROM mark_grids mg
            WHERE mg.exam_id = e.id AND mg.tenant_id = $1 AND mg.state = 'SUBMITTED'
              AND mg.section_id IN (SELECT cs.id FROM class_sections cs
                WHERE cs.class_id = e.class_id AND cs.tenant_id = $1 AND cs.deleted_at IS NULL)
              AND mg.subject_id IN (SELECT ec.subject_id FROM exam_components ec
                WHERE ec.exam_id = e.id AND ec.tenant_id = $1 AND ec.deleted_at IS NULL)) AS submitted
       FROM exams e
       JOIN classes c ON c.id = e.class_id
       WHERE e.tenant_id = $1 AND e.id = ANY($2::uuid[])
       ORDER BY c.numeric_grade NULLS LAST, c.name`,
      [tenantId, group.exam_ids],
    );

    const classes: MarkEntryClassDto[] = rows.map((r) => {
      const submitted = Number(r.submitted);
      const total = Number(r.total);
      return {
        class_id: r.class_id,
        class_name: r.class_name,
        exam_id: r.exam_id,
        submitted,
        total,
        percentage: pct(submitted, total),
      };
    });
    const submitted = classes.reduce((n, c) => n + c.submitted, 0);
    const total = classes.reduce((n, c) => n + c.total, 0);
    const lowest = classes.reduce<MarkEntryClassDto | null>(
      (min, c) => (!min || c.percentage < min.percentage ? c : min),
      null,
    );

    return {
      exam_name: group.name,
      mark_entry_deadline: group.deadline,
      exam_ended_days_ago:
        group.last_date < today
          ? Math.round((Date.parse(today) - Date.parse(group.last_date)) / DAY_MS)
          : null,
      overall: { submitted, total, percentage: pct(submitted, total) },
      classes,
      lowest_class_id: lowest?.class_id ?? null,
    };
  }

  /**
   * [8.10.7.3.03] One statement, no loop. Targets = sections the caller is
   * SUBJECT_TEACHER of (the write rule) x DRAFT exams of that section's class
   * with a live component for the subject. `expected` is the ACTIVE-enrollment
   * roster of `MarkGridService.getGrid`; `entered` = roster students holding a
   * mark row for every live component of the subject.
   */
  async myMarkDeadlines(tenantId: string, userId: string): Promise<MyMarkDeadlinesDto> {
    const rows = await this.dataSource.query<
      Array<
        Omit<MyMarkDeadlineItemDto, 'entered' | 'expected'> & { entered: string; expected: string }
      >
    >(
      `WITH mine AS (
         SELECT DISTINCT tcs.section_id, tcs.subject_id
         FROM teacher_class_sections tcs
         JOIN teachers t ON t.id = tcs.teacher_id AND t.tenant_id = $1
              AND t.user_id = $2 AND t.deleted_at IS NULL
         WHERE tcs.tenant_id = $1 AND tcs.assignment_type = 'SUBJECT_TEACHER'
           AND tcs.subject_id IS NOT NULL
       ),
       targets AS (
         SELECT e.id AS exam_id, e.name AS exam_name, e.academic_year_id, e.class_id,
                e.mark_entry_deadline::text AS mark_entry_deadline,
                cs.id AS section_id, cs.section_name, c.name AS class_name,
                sj.id AS subject_id, sj.name_en AS subject_name_en, sj.name_bn AS subject_name_bn,
                comp.n AS component_count
         FROM mine m
         JOIN class_sections cs ON cs.id = m.section_id AND cs.tenant_id = $1 AND cs.deleted_at IS NULL
         JOIN classes c ON c.id = cs.class_id AND c.tenant_id = $1 AND c.deleted_at IS NULL
         JOIN subjects sj ON sj.id = m.subject_id AND sj.tenant_id = $1 AND sj.deleted_at IS NULL
         JOIN exams e ON e.class_id = cs.class_id AND e.tenant_id = $1
              AND e.status = 'DRAFT' AND e.deleted_at IS NULL
         CROSS JOIN LATERAL (
           SELECT COUNT(*) AS n FROM exam_components ec
           WHERE ec.exam_id = e.id AND ec.subject_id = m.subject_id
             AND ec.tenant_id = $1 AND ec.deleted_at IS NULL
         ) comp
         WHERE comp.n > 0
       )
       SELECT t.exam_id, t.exam_name, t.section_id, t.class_name, t.section_name,
              t.subject_id, t.subject_name_en, t.subject_name_bn,
              COALESCE(mg.state::text, 'DRAFT') AS state,
              t.mark_entry_deadline,
              (SELECT MAX(es.date)::text FROM exam_schedules es
                WHERE es.exam_id = t.exam_id AND es.subject_id = t.subject_id
                  AND es.tenant_id = $1 AND es.deleted_at IS NULL) AS last_sitting_date,
              r.expected, r.entered
       FROM targets t
       LEFT JOIN mark_grids mg ON mg.exam_id = t.exam_id AND mg.section_id = t.section_id
            AND mg.subject_id = t.subject_id AND mg.tenant_id = $1
       CROSS JOIN LATERAL (
         SELECT COUNT(*) AS expected,
                COUNT(*) FILTER (WHERE (
                  SELECT COUNT(DISTINCT mk.component_id) FROM marks mk
                  JOIN exam_components ec ON ec.id = mk.component_id AND ec.deleted_at IS NULL
                  WHERE mk.exam_id = t.exam_id AND mk.student_id = en.student_id
                    AND mk.subject_id = t.subject_id AND mk.tenant_id = $1
                ) = t.component_count) AS entered
         FROM enrollments en
         JOIN students s ON s.id = en.student_id AND s.tenant_id = $1 AND s.deleted_at IS NULL
         WHERE en.tenant_id = $1 AND en.enrollment_status = 'ACTIVE'
           AND en.academic_year_id = t.academic_year_id AND en.class_id = t.class_id
           AND en.section_id = t.section_id
       ) r
       ORDER BY (COALESCE(mg.state::text, 'DRAFT') = 'DRAFT') DESC,
                t.mark_entry_deadline ASC NULLS LAST, last_sitting_date ASC NULLS LAST,
                t.class_name, t.section_name`,
      [tenantId, userId],
    );

    const items: MyMarkDeadlineItemDto[] = rows.map((r) => ({
      ...r,
      entered: Number(r.entered),
      expected: Number(r.expected),
    }));
    return {
      outstanding_students: items
        .filter((i) => i.state === 'DRAFT')
        .reduce((n, i) => n + i.expected - i.entered, 0),
      items,
    };
  }
}
