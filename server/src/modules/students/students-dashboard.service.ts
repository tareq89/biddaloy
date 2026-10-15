import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { endOfLocalDay, localToday, startOfLocalDay } from '../../common/time';
import { INCOMPLETE_GUARDIAN_SQL } from './students.service';
import type { GuardiansIncompleteDto, StudentsAddedTodayDto } from './dto/students-dashboard.dto';

/** Office-staff widgets. Counts only, tenant-scoped, soft-deleted rows excluded. */
@Injectable()
export class StudentsDashboardService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async getGuardiansIncomplete(tenantId: string): Promise<GuardiansIncompleteDto> {
    const [row] = await this.dataSource.query<Array<{ incomplete: string; total: string }>>(
      `SELECT COUNT(*) FILTER (WHERE ${INCOMPLETE_GUARDIAN_SQL}) AS incomplete, COUNT(*) AS total
         FROM guardians guardian
        WHERE guardian.tenant_id = $1 AND guardian.deleted_at IS NULL`,
      [tenantId],
    );
    return { incomplete_count: Number(row.incomplete), total_count: Number(row.total) };
  }

  async getStudentsAddedToday(tenantId: string): Promise<StudentsAddedTodayDto> {
    const today = localToday();
    const [row] = await this.dataSource.query<Array<{ n: string }>>(
      `SELECT COUNT(*) AS n FROM students
        WHERE tenant_id = $1 AND deleted_at IS NULL AND created_at BETWEEN $2 AND $3`,
      [tenantId, startOfLocalDay(today), endOfLocalDay(today)],
    );
    return { added_today: Number(row.n), as_of: today };
  }
}
