import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { FeeDuesService } from '../../fees/fee-dues.service';
import { SchoolSettingsReader } from '../../schools/settings/school-settings-reader.service';
import {
  AdmitCardRosterDto,
  MeritCandidateDto,
  MeritCandidatesQueryDto,
} from './dto/exam-documents.dto';

/** [48.2.05] Read-only feeds for the exam "Print" tab. Every query is tenant-scoped in SQL. */
@Injectable()
export class ExamDocumentsService {
  constructor(
    private readonly ds: DataSource,
    private readonly feeDues: FeeDuesService,
    private readonly settings: SchoolSettingsReader,
  ) {}

  private async getExam(tenantId: string, examId: string) {
    const [exam] = await this.ds.query(
      `SELECT id, class_id, academic_year_id FROM exams
       WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [examId, tenantId],
    );
    if (!exam) throw new NotFoundException('Exam not found');
    return exam as { id: string; class_id: string; academic_year_id: string };
  }

  async admitCardRoster(tenantId: string, examId: string): Promise<AdmitCardRosterDto> {
    const exam = await this.getExam(tenantId, examId);

    const rows: Array<{
      student_id: string;
      full_name: string;
      roll_number: number;
      section_name: string | null;
      printed_copies: string;
      last_printed_at: Date | null;
    }> = await this.ds.query(
      `SELECT s.id AS student_id, s.full_name, s.roll_number, cs.section_name,
              COALESCE(p.copies, 0) AS printed_copies, p.last_at AS last_printed_at
       FROM enrollments e
       JOIN students s ON s.id = e.student_id AND s.tenant_id = e.tenant_id AND s.deleted_at IS NULL
       LEFT JOIN class_sections cs ON cs.id = e.section_id
       LEFT JOIN (
         SELECT subject_id, COUNT(*) AS copies, MAX(created_at) AS last_at
         FROM print_job_items
         WHERE tenant_id = $1 AND document_kind = 'EXAM_ADMIT_CARD' AND context_id = $2
           AND revoked_at IS NULL AND outcome <> 'FAILED'
         GROUP BY subject_id
       ) p ON p.subject_id = s.id
       WHERE e.tenant_id = $1 AND e.class_id = $3 AND e.academic_year_id = $4
         AND e.enrollment_status = 'ACTIVE'
       ORDER BY cs.section_name NULLS LAST, s.roll_number`,
      [tenantId, examId, exam.class_id, exam.academic_year_id],
    );

    const [published] = await this.ds.query(
      `SELECT 1 FROM seat_plan_schedules sps
       JOIN seat_plans sp ON sp.id = sps.seat_plan_id AND sp.tenant_id = sps.tenant_id
       JOIN exam_schedules es ON es.id = sps.exam_schedule_id
       WHERE sps.tenant_id = $1 AND es.exam_id = $2 AND sps.deleted_at IS NULL
         AND es.deleted_at IS NULL AND sp.deleted_at IS NULL AND sp.status = 'PUBLISHED'
       LIMIT 1`,
      [tenantId, examId],
    );

    const withhold =
      (await this.settings.documentsSettings(tenantId)).withholdAdmitCardForDues === true;
    // Fee data is only read when the school withholds for dues (D9).
    const dues = withhold
      ? await this.feeDues.getDueSnapshots(
          rows.map((r) => r.student_id),
          tenantId,
        )
      : null;

    return {
      withhold_for_dues: withhold,
      seat_plan_published: !!published,
      students: rows.map((r) => ({
        student_id: r.student_id,
        full_name: r.full_name,
        roll_number: r.roll_number,
        section_name: r.section_name,
        printed_copies: Number(r.printed_copies),
        last_printed_at: r.last_printed_at ? new Date(r.last_printed_at).toISOString() : null,
        has_dues: dues ? (dues.get(r.student_id)?.total_due ?? 0) > 0 : null,
      })),
    };
  }

  async meritCandidates(
    tenantId: string,
    examId: string,
    { scope, top }: MeritCandidatesQueryDto,
  ): Promise<MeritCandidateDto[]> {
    await this.getExam(tenantId, examId);
    const bySection = scope === 'SECTION';
    const rows = await this.ds.query(
      `SELECT s.id AS student_id, s.full_name, cs.section_name, r.position, r.section_position, r.gpa
       FROM results r
       JOIN students s ON s.id = r.student_id AND s.tenant_id = r.tenant_id AND s.deleted_at IS NULL
       LEFT JOIN class_sections cs ON cs.id = r.section_id AND cs.tenant_id = r.tenant_id
       WHERE r.tenant_id = $1 AND r.exam_id = $2 AND r.deleted_at IS NULL
         AND r.published_at IS NOT NULL AND r.is_fail = false
         AND ${bySection ? 'r.section_position' : 'r.position'} <= $3
       ORDER BY ${bySection ? 'cs.section_name NULLS LAST, r.section_id, r.section_position, r.position' : 'r.position'}`,
      [tenantId, examId, top],
    );
    return rows.map((r: any) => ({
      student_id: r.student_id,
      full_name: r.full_name,
      section_name: r.section_name,
      position: r.position,
      section_position: r.section_position,
      gpa: Number(r.gpa),
    }));
  }
}
