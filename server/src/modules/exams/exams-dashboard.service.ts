import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { MarkEntryClassDto, MarkEntryProgressWidgetDto } from './dto/exams-dashboard.dto';

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
}
