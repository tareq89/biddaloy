import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Enrollment } from '../students/entities/enrollment.entity';
import { CommitteeEnrollmentDto } from './dto/enrollments-dashboard.dto';

@Injectable()
export class EnrollmentsDashboardService {
  constructor(@InjectRepository(Enrollment) private readonly repo: Repository<Enrollment>) {}

  /**
   * Students on the roll at year end (ACTIVE or GRADUATED), last 5 years up to the current one.
   * `is_current DESC` keeps the current year last when two years share a start date.
   */
  async getEnrollmentTrend(tenantId: string): Promise<CommitteeEnrollmentDto> {
    const rows: { year_label: string; student_count: string }[] = await this.repo.manager.query(
      `SELECT ay.name AS year_label,
              COUNT(e.id) FILTER (WHERE e.enrollment_status IN ('ACTIVE','GRADUATED')) AS student_count
         FROM academic_years ay
         LEFT JOIN enrollments e ON e.academic_year_id = ay.id AND e.tenant_id = $1
        WHERE ay.tenant_id = $1 AND ay.deleted_at IS NULL
          AND ay.start_date <= (SELECT start_date FROM academic_years
                                 WHERE tenant_id = $1 AND is_current AND deleted_at IS NULL)
        GROUP BY ay.id, ay.name, ay.start_date
        ORDER BY ay.start_date DESC, ay.is_current DESC LIMIT 5`,
      [tenantId],
    );
    const years = rows
      .map((r) => ({ year_label: r.year_label, student_count: Number(r.student_count) }))
      .reverse();
    return {
      years,
      current_count: years.at(-1)?.student_count ?? 0,
      previous_count: years.length > 1 ? years[years.length - 2].student_count : null,
    };
  }
}
