import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SeatPlanStatusDto } from './dto/seat-plans-dashboard.dto';

const MAX_ROWS = 10;

/** [8.10.7.4.11] Which upcoming exams still need a seat plan. */
@Injectable()
export class SeatPlansDashboardService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** `today` is the school's local date (YYYY-MM-DD). */
  async getStatus(tenantId: string, today: string): Promise<SeatPlanStatusDto> {
    const rows = await this.dataSource.query<
      Array<{
        exam_id: string;
        exam_name: string;
        class_name: string;
        first_date: string;
        schedule_count: string;
        planned_count: string;
        published_count: string;
      }>
    >(
      `SELECT e.id AS exam_id, e.name AS exam_name, c.name AS class_name,
              MIN(es.date)::text AS first_date,
              COUNT(DISTINCT es.id) AS schedule_count,
              COUNT(DISTINCT es.id) FILTER (WHERE sp.id IS NOT NULL) AS planned_count,
              COUNT(DISTINCT es.id) FILTER (WHERE sp.status = 'PUBLISHED') AS published_count
       FROM exams e
       JOIN academic_years ay ON ay.id = e.academic_year_id AND ay.tenant_id = $1 AND ay.is_current
       JOIN classes c ON c.id = e.class_id AND c.tenant_id = $1
       JOIN exam_schedules es ON es.exam_id = e.id AND es.tenant_id = $1 AND es.deleted_at IS NULL
       LEFT JOIN seat_plan_schedules sps
         ON sps.exam_schedule_id = es.id AND sps.tenant_id = $1 AND sps.deleted_at IS NULL
       LEFT JOIN seat_plans sp
         ON sp.id = sps.seat_plan_id AND sp.tenant_id = $1 AND sp.deleted_at IS NULL
       WHERE e.tenant_id = $1 AND e.deleted_at IS NULL
       GROUP BY e.id, e.name, c.name
       HAVING MIN(es.date) >= $2::date
       ORDER BY MIN(es.date), e.name, e.id`,
      [tenantId, today],
    );
    const exams = rows.map((r) => ({
      exam_id: r.exam_id,
      exam_name: r.exam_name,
      class_name: r.class_name,
      first_date: r.first_date,
      schedule_count: Number(r.schedule_count),
      planned_count: Number(r.planned_count),
      published_count: Number(r.published_count),
    }));
    return {
      exams_needing_plan: exams.filter((x) => x.planned_count < x.schedule_count).length,
      exams: exams.slice(0, MAX_ROWS),
    };
  }
}
