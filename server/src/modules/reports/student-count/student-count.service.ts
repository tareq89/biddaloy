import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { suppressSmallCells } from '../engine/security/small-cell';
import {
  NOT_GIVEN_BN,
  type StaffCountDto,
  type StudentCountDto,
  type StudentCountRowDto,
} from './dto/student-count.dto';

interface RawStudentRow {
  class_name: string;
  class_order: number | null;
  gender: string | null;
  religion: string | null;
  count: string;
}

interface RawStaffRow {
  staff_type: 'TEACHING' | 'NON_TEACHING' | 'UNASSIGNED';
  count: string;
}

/** Column headings of the two export tables, Bangla first (Epic 8.15 D21). */
export const STUDENT_TABLE_HEADER = ['শ্রেণি', 'লিঙ্গ', 'ধর্ম', 'শিক্ষার্থী'];
export const STAFF_TABLE_HEADER = ['ধরন', 'জন'];
const STAFF_TYPE_BN: Record<string, string> = {
  TEACHING: 'শিক্ষক',
  NON_TEACHING: 'কর্মচারী',
  UNASSIGNED: NOT_GIVEN_BN,
};

/**
 * [8.15.53] The early BANBEIS head count (D23): active students by class × gender × religion and
 * staff by type, for one academic year. Temporary and coded: it is replaced by the system report
 * of [8.15.32], and the epic close removes it. Staff gender is not stored anywhere in the school
 * data, so staff are counted by type only.
 */
@Injectable()
export class StudentCountService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async getCount(
    tenantId: string,
    role: string,
    academicYearId?: string,
  ): Promise<StudentCountDto> {
    const year = await this.resolveYear(tenantId, academicYearId);
    if (!year) {
      return {
        academic_year_id: null,
        academic_year_name: null,
        rows: [],
        totals: { students: 0 },
        staff: await this.staff(tenantId, role),
      };
    }

    const raw: RawStudentRow[] = await this.dataSource.query(
      `SELECT c.name AS class_name, c.numeric_grade AS class_order, s.gender, s.religion,
              COUNT(DISTINCT e.student_id)::text AS count
         FROM enrollments e
         JOIN students s ON s.id = e.student_id AND s.tenant_id = e.tenant_id AND s.deleted_at IS NULL
         JOIN classes c ON c.id = e.class_id AND c.tenant_id = e.tenant_id AND c.deleted_at IS NULL
        WHERE e.tenant_id = $1 AND e.academic_year_id = $2 AND e.enrollment_status = 'ACTIVE'
        GROUP BY c.name, c.numeric_grade, s.gender, s.religion
        ORDER BY c.numeric_grade NULLS LAST, c.name, s.gender NULLS LAST, s.religion NULLS LAST`,
      [tenantId, year.id],
    );

    const counted = raw.map((r) => ({
      class_name: r.class_name,
      class_order: r.class_order ?? 0,
      gender: r.gender ?? NOT_GIVEN_BN,
      religion: r.religion ?? NOT_GIVEN_BN,
      count: Number(r.count),
    }));
    // The total is the true number: the small-cell rule hides cells, not totals (D14).
    const students = counted.reduce((sum, r) => sum + r.count, 0);

    return {
      academic_year_id: year.id,
      academic_year_name: year.name,
      rows: suppressSmallCells(counted, ['count'], role) as StudentCountRowDto[],
      totals: { students },
      staff: await this.staff(tenantId, role),
    };
  }

  /** Current staff by type: teaching or not by their open designation. */
  private async staff(tenantId: string, role: string): Promise<StaffCountDto> {
    const raw: RawStaffRow[] = await this.dataSource.query(
      `SELECT CASE d.is_teaching WHEN TRUE THEN 'TEACHING' WHEN FALSE THEN 'NON_TEACHING'
                ELSE 'UNASSIGNED' END AS staff_type,
              COUNT(*)::text AS count
         FROM staff_profiles sp
         JOIN users u ON u.id = sp.user_id AND u.deleted_at IS NULL
         LEFT JOIN LATERAL (
           SELECT dd.is_teaching
             FROM staff_designation_history h
             JOIN designations dd ON dd.id = h.designation_id AND dd.tenant_id = h.tenant_id
            WHERE h.tenant_id = sp.tenant_id AND h.user_id = sp.user_id AND h.end_date IS NULL
            ORDER BY h.effective_date DESC
            LIMIT 1
         ) d ON TRUE
        WHERE sp.tenant_id = $1
        GROUP BY 1
        ORDER BY 1`,
      [tenantId],
    );
    const counted = raw.map((r) => ({ staff_type: r.staff_type, count: Number(r.count) }));
    return {
      rows: suppressSmallCells(counted, ['count'], role),
      total: counted.reduce((sum, r) => sum + r.count, 0),
    };
  }

  /** The requested year (must belong to this school) or the current one; `null` when there is none. */
  private async resolveYear(
    tenantId: string,
    academicYearId?: string,
  ): Promise<{ id: string; name: string } | null> {
    const rows: Array<{ id: string; name: string }> = academicYearId
      ? await this.dataSource.query(
          `SELECT id, name FROM academic_years WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
          [tenantId, academicYearId],
        )
      : await this.dataSource.query(
          `SELECT id, name FROM academic_years
            WHERE tenant_id = $1 AND is_current = TRUE AND deleted_at IS NULL
            ORDER BY start_date DESC LIMIT 1`,
          [tenantId],
        );
    if (rows.length === 0) {
      if (academicYearId) throw new NotFoundException('Academic year not found');
      return null;
    }
    return rows[0];
  }

  /** Rows for the export of one table, with the header, as plain cells (a hidden count is an empty cell). */
  async exportRows(
    tenantId: string,
    role: string,
    table: 'students' | 'staff',
    academicYearId?: string,
  ): Promise<{ header: string[]; rows: unknown[][]; filename: string }> {
    const data = await this.getCount(tenantId, role, academicYearId);
    if (table === 'staff') {
      return {
        header: STAFF_TABLE_HEADER,
        rows: data.staff.rows.map((r) => [STAFF_TYPE_BN[r.staff_type], r.count ?? '']),
        filename: 'staff-count',
      };
    }
    return {
      header: STUDENT_TABLE_HEADER,
      rows: data.rows.map((r) => [r.class_name, r.gender, r.religion, r.count ?? '']),
      filename: 'student-count',
    };
  }
}
