import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Exam } from './entities/exam.entity';
import { AttendanceSummaryService } from '../attendance/attendance-summary.service';
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

    const summary = await this.attendanceSummaryService.getSectionSummary({
      tenantId: input.tenantId,
      sectionId: input.sectionId,
      from: exam.academic_term.start_date,
      to: exam.academic_term.end_date,
    });

    const fullMarks = Number(input.fullMarks);
    const valuesByStudent = new Map<string, string | null>();
    for (const student of summary.students) {
      if (student.attendance_percentage === null) {
        valuesByStudent.set(student.student_id, null);
        continue;
      }
      const raw = (student.attendance_percentage / 100) * fullMarks;
      valuesByStudent.set(student.student_id, roundHalfUp2(raw).toFixed(2));
    }

    return { valuesByStudent, reason: null };
  }
}
