import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Exam } from './entities/exam.entity';
import { AttendanceSummaryService } from '../attendance/attendance-summary.service';
import { sectionRosterStudentIds } from '../enrollments/section-roster';
import { roundHalfUp2 } from './result-rules';

export interface AttendanceComponentResult {
  /** studentId -> computed value, or null when unmeasurable for that
   * student (no attendance marked at all in the window). */
  valuesByStudent: Map<string, string | null>;
  /** Set when the whole component is unmeasurable — no academic term on
   * the exam, so there is no window to compute over (D11: this must
   * explain itself, never silently read as zero). */
  reason: string | null;
}

/**
 * [19.4.1] D11 — computes a `DERIVED`/`ATTENDANCE` component's value from
 * real attendance data, reusing `AttendanceSummaryService` (the "single
 * source of truth" the [9.4] epic built exactly for this — see that
 * service's own docstring, which calls itself "a contract with a future
 * exam module"). Never re-derives percentage-present from
 * `AttendanceRecord` directly.
 */
@Injectable()
export class AttendanceComponentService {
  constructor(
    @InjectRepository(Exam)
    private readonly examRepo: Repository<Exam>,
    private readonly attendanceSummaryService: AttendanceSummaryService,
  ) {}

  async computeForSection(input: {
    examId: string;
    sectionId: string;
    fullMarks: string;
    tenantId: string;
  }): Promise<AttendanceComponentResult> {
    const exam = await this.examRepo.findOne({
      where: { id: input.examId, tenant_id: input.tenantId },
      relations: ['academic_term'],
    });

    if (!exam?.academic_term) {
      return {
        valuesByStudent: new Map(),
        reason: 'This exam has no academic term set, so attendance cannot be computed.',
      };
    }

    // Cohort = who is enrolled in this section for its own year (D17), not
    // where students sit today; working days use the exam's class.
    const studentIds = await sectionRosterStudentIds(
      this.examRepo.manager,
      input.tenantId,
      input.sectionId,
      { activeOnly: true },
    );
    const summaries = await this.attendanceSummaryService.getSummariesForStudents({
      tenantId: input.tenantId,
      studentIds,
      classId: exam.class_id,
      from: exam.academic_term.start_date,
      to: exam.academic_term.end_date,
    });

    const fullMarks = Number(input.fullMarks);
    const valuesByStudent = new Map<string, string | null>();
    for (const studentId of studentIds) {
      const pct = summaries.get(studentId)?.attendance_percentage ?? null;
      if (pct === null) {
        valuesByStudent.set(studentId, null);
        continue;
      }
      valuesByStudent.set(studentId, roundHalfUp2((pct / 100) * fullMarks).toFixed(2));
    }

    return { valuesByStudent, reason: null };
  }
}
