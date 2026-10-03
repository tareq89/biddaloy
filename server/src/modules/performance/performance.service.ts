import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  ExamStatus,
  Permission,
  UserRole,
  hasTenantScope,
  roleHasPermission,
} from '@biddaloy/shared';
import { Exam } from '../exams/entities/exam.entity';
import { Student } from '../students/entities/student.entity';
import { Enrollment } from '../students/entities/enrollment.entity';
import { StudentNote } from '../students/entities/student-note.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { AcademicTerm } from '../calendar/entities/academic-term.entity';
import { AnalysisService } from '../exams/analysis.service';
import { AttendanceSummaryService } from '../attendance/attendance-summary.service';
import { HomeworkAnalyticsService } from '../homework/homework-analytics.service';
import { SchoolsService } from '../schools/schools.service';
import { localToday } from '../attendance/attendance-policy.util';
import {
  ClassExamOutcomeDto,
  ClassPerformanceQueryDto,
  ClassPerformanceResponseDto,
  HomeworkRollupDto,
  PerformanceQueryDto,
  StudentExamOutcomeDto,
  StudentPerformanceResponseDto,
} from './dto/performance.dto';

export type Caller = { tenantId: string; role: string; userId: string };
export type Range = { academicYearId: string; termId: string | null; from: string; to: string };

/** Tenant-wide performance reads: tenant scope AND the permission the routes
 * require (MARK_VIEW). ACCOUNTANT has tenant scope but not MARK_VIEW, so stays out. */
const canReadTenantWide = (role: string) =>
  hasTenantScope(role) && roleHasPermission(role, Permission.MARK_VIEW);

// Unweighted mean of existing per-exam/per-section outputs — no new statistics (D17).
function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}
function round(x: number | null, dp: number): number | null {
  return x === null ? null : Math.round(x * 10 ** dp) / 10 ** dp;
}
function rollup(r: HomeworkRollupDto): HomeworkRollupDto {
  return {
    totalAssignments: r.totalAssignments,
    completed: r.completed,
    defaulters: r.defaulters,
    completionPercent: r.completionPercent,
  };
}

@Injectable()
export class PerformanceService {
  constructor(
    @InjectRepository(Exam) private readonly examRepo: Repository<Exam>,
    @InjectRepository(Student) private readonly studentRepo: Repository<Student>,
    @InjectRepository(Enrollment) private readonly enrollmentRepo: Repository<Enrollment>,
    @InjectRepository(Class) private readonly classRepo: Repository<Class>,
    @InjectRepository(ClassSection) private readonly sectionRepo: Repository<ClassSection>,
    @InjectRepository(AcademicYear) private readonly yearRepo: Repository<AcademicYear>,
    @InjectRepository(AcademicTerm) private readonly termRepo: Repository<AcademicTerm>,
    @InjectRepository(StudentNote) private readonly noteRepo: Repository<StudentNote>,
    private readonly analysisService: AnalysisService,
    private readonly attendanceSummaryService: AttendanceSummaryService,
    private readonly homeworkAnalyticsService: HomeworkAnalyticsService,
    private readonly schoolsService: SchoolsService,
  ) {}

  private async timezone(tenantId: string): Promise<string> {
    const settings = await this.schoolsService.getResolvedSettings(tenantId);
    return settings.region?.timezone ?? 'UTC';
  }

  /** Year (or term) window; 404s on unknown/cross-tenant ids. Public for #1243. */
  async resolveRange(tenantId: string, academicYearId: string, termId?: string): Promise<Range> {
    const year = await this.yearRepo.findOne({
      where: { id: academicYearId, tenant_id: tenantId },
    });
    if (!year) throw new NotFoundException('Academic year not found');
    if (!termId) {
      return {
        academicYearId,
        termId: null,
        from: String(year.start_date),
        to: String(year.end_date),
      };
    }
    const term = await this.termRepo.findOne({
      where: { id: termId, tenant_id: tenantId, academic_year_id: academicYearId },
    });
    if (!term) throw new NotFoundException('Term not found');
    return { academicYearId, termId, from: String(term.start_date), to: String(term.end_date) };
  }

  /** Clamp to today: future working days would otherwise count as unmarked. */
  private attendanceWindow(range: Range, tz: string): { from: string; to: string } | null {
    const today = localToday(tz);
    const to = range.to < today ? range.to : today;
    return range.from > to ? null : { from: range.from, to };
  }

  private listExams(tenantId: string, classId: string, range: Range): Promise<Exam[]> {
    return this.examRepo.find({
      where: {
        tenant_id: tenantId,
        class_id: classId,
        academic_year_id: range.academicYearId,
        status: In([ExamStatus.PROCESSED, ExamStatus.PUBLISHED]),
        ...(range.termId ? { academic_term_id: range.termId } : {}),
      },
      order: { created_at: 'ASC' },
    });
  }

  private async assertTeacherScope(
    caller: Caller,
    target: { sectionId: string } | { classId: string },
  ): Promise<void> {
    if (canReadTenantWide(caller.role)) return;
    if (caller.role === UserRole.TEACHER) {
      const { tenantId, userId } = caller;
      const qb = this.sectionRepo
        .createQueryBuilder('cs')
        .innerJoin(
          'teacher_class_sections',
          'tcs',
          'tcs.section_id = cs.id AND tcs.tenant_id = :tenantId',
          { tenantId },
        )
        .innerJoin('teachers', 't', 't.id = tcs.teacher_id AND t.tenant_id = :tenantId', {
          tenantId,
        })
        .where('cs.tenant_id = :tenantId', { tenantId })
        .andWhere('cs.deleted_at IS NULL')
        .andWhere('t.user_id = :userId', { userId });
      if ('sectionId' in target) qb.andWhere('cs.id = :sectionId', { sectionId: target.sectionId });
      else qb.andWhere('cs.class_id = :classId', { classId: target.classId });
      if (await qb.getOne()) return;
    }
    throw new ForbiddenException('You do not have access to this class');
  }

  /**
   * Class (or one section) outcomes. Does NO access check — callers gate it
   * themselves (#1243 calls it behind ACR_READ).
   */
  async computeClassOutcomes(
    tenantId: string,
    classId: string,
    sectionId: string | null,
    range: Range,
  ): Promise<ClassPerformanceResponseDto> {
    const tz = await this.timezone(tenantId);
    const exams = await this.listExams(tenantId, classId, range);
    const outcomes: ClassExamOutcomeDto[] = await Promise.all(
      exams.map(async (exam) => {
        const { overall } = await this.analysisService.getPassFail(
          exam.id,
          tenantId,
          sectionId ?? undefined,
        );
        return {
          examId: exam.id,
          examName: exam.name,
          appeared: overall.appeared,
          passRate: overall.pass_pct,
          averageMarks: overall.average,
        };
      }),
    );
    // Skip exams nobody sat, so an empty section doesn't drag the rate to 0.
    const counted = outcomes.filter((e) => e.appeared > 0);

    const window = this.attendanceWindow(range, tz);
    let attendancePercent: number | null = null;
    if (window) {
      if (sectionId) {
        const s = await this.attendanceSummaryService.getSectionSummary({
          tenantId,
          sectionId,
          ...window,
        });
        attendancePercent = s.section_percentage;
      } else {
        const sections = await this.sectionRepo.find({
          where: { tenant_id: tenantId, class_id: classId },
        });
        const pcts = await Promise.all(
          sections.map(
            async (sec) =>
              (
                await this.attendanceSummaryService.getSectionSummary({
                  tenantId,
                  sectionId: sec.id,
                  ...window,
                })
              ).section_percentage,
          ),
        );
        attendancePercent = round(mean(pcts.flatMap((p) => (p === null ? [] : [p]))), 2);
      }
    }

    const homework = sectionId
      ? await this.homeworkAnalyticsService.getSectionRollup(sectionId, tenantId, tz)
      : await this.homeworkAnalyticsService.getClassRollup(classId, tenantId, tz);

    return {
      classId,
      sectionId,
      ...range,
      passRate: round(mean(counted.map((e) => e.passRate)), 1),
      averageMarks: round(
        mean(counted.flatMap((e) => (e.averageMarks === null ? [] : [e.averageMarks]))),
        2,
      ),
      attendancePercent,
      homework: rollup(homework),
      exams: outcomes,
    };
  }

  async getClassPerformance(
    classId: string,
    query: ClassPerformanceQueryDto,
    caller: Caller,
  ): Promise<ClassPerformanceResponseDto> {
    const { tenantId } = caller;
    const range = await this.resolveRange(tenantId, query.academicYearId, query.termId);
    if (!(await this.classRepo.findOne({ where: { id: classId, tenant_id: tenantId } }))) {
      throw new NotFoundException('Class not found');
    }
    if (query.sectionId) {
      const section = await this.sectionRepo.findOne({
        where: { id: query.sectionId, tenant_id: tenantId, class_id: classId },
      });
      if (!section) throw new NotFoundException('Section not found');
    }
    await this.assertTeacherScope(
      caller,
      query.sectionId ? { sectionId: query.sectionId } : { classId },
    );
    return this.computeClassOutcomes(tenantId, classId, query.sectionId ?? null, range);
  }

  async getStudentPerformance(
    studentId: string,
    query: PerformanceQueryDto,
    caller: Caller,
  ): Promise<StudentPerformanceResponseDto> {
    const { tenantId } = caller;
    const range = await this.resolveRange(tenantId, query.academicYearId, query.termId);
    if (!(await this.studentRepo.findOne({ where: { id: studentId, tenant_id: tenantId } }))) {
      throw new NotFoundException('Student not found');
    }
    const enrollment = await this.enrollmentRepo.findOne({
      where: { tenant_id: tenantId, student_id: studentId, academic_year_id: range.academicYearId },
      order: { enrolled_at: 'DESC' },
    });
    if (!enrollment) throw new NotFoundException('Student has no enrollment in this academic year');
    await this.assertTeacherScope(
      caller,
      enrollment.section_id
        ? { sectionId: enrollment.section_id }
        : { classId: enrollment.class_id },
    );

    const tz = await this.timezone(tenantId);
    const exams = await this.listExams(tenantId, enrollment.class_id, range);
    // No sectionId: the student may have moved section since processing.
    const found = await Promise.all(
      exams.map(async (exam) => {
        const { rows } = await this.analysisService.getMerit(exam.id, tenantId);
        const row = rows.find((r) => r.student_id === studentId);
        return row ? { exam, row } : null;
      }),
    );
    const hits = found.flatMap((h) => (h ? [h] : []));
    const outcomes: StudentExamOutcomeDto[] = hits.map(({ exam, row }) => ({
      examId: exam.id,
      examName: exam.name,
      totalMarks: row.total_marks,
      gpa: row.gpa,
      grade: row.grade,
      isFail: row.is_fail,
    }));

    const window = this.attendanceWindow(range, tz);
    const [attendance, homework, rating] = await Promise.all([
      window
        ? this.attendanceSummaryService.getStudentSummary({ tenantId, studentId, ...window })
        : Promise.resolve(null),
      this.homeworkAnalyticsService.getStudentRollup(studentId, tenantId, tz),
      // ponytail: day boundary is the DB session timezone (UTC); switch to school-tz
      // boundaries if a school reports an off-by-one at term edges.
      this.noteRepo
        .createQueryBuilder('n')
        .select('AVG(n.rating)', 'average')
        .addSelect('COUNT(n.rating)', 'count')
        .where('n.tenant_id = :tenantId', { tenantId })
        .andWhere('n.student_id = :studentId', { studentId })
        .andWhere('n.deleted_at IS NULL')
        .andWhere('n.created_at >= CAST(:from AS date)', { from: range.from })
        .andWhere('n.created_at < CAST(:to AS date) + 1', { to: range.to })
        .getRawOne<{ average: string | null; count: string }>(),
    ]);

    return {
      studentId,
      classId: enrollment.class_id,
      sectionId: enrollment.section_id,
      ...range,
      passRate: round(mean(outcomes.map((o) => (o.isFail ? 0 : 100))), 1),
      averageMarks: round(mean(outcomes.map((o) => o.totalMarks)), 2),
      averageGpa: round(mean(outcomes.map((o) => o.gpa)), 2),
      attendancePercent: attendance ? attendance.attendance_percentage : null,
      homework: rollup(homework),
      noteRatingAverage:
        !rating || rating.average === null ? null : round(Number(rating.average), 2),
      noteRatingCount: Number(rating?.count ?? 0),
      exams: outcomes,
    };
  }
}
