import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { ExamStatus } from '@biddaloy/shared';
import { Exam } from './entities/exam.entity';
import { Result } from './entities/result.entity';
import { ResultSubject } from './entities/result-subject.entity';
import { Mark } from './entities/mark.entity';
import { ExamComponent } from './entities/exam-component.entity';
import { Student } from '../students/entities/student.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Subject } from '../academics/entities/subject.entity';

export interface MeritRow {
  student_id: string;
  roll_number: number;
  full_name: string;
  section_id: string | null;
  section_name: string | null;
  total_marks: number;
  gpa: number;
  grade: string;
  position: number | null;
  section_position: number | null;
  is_fail: boolean;
}

export interface DefaultedRow extends MeritRow {
  failed_subjects: Array<{ subject_id: string; name: string }>;
  absent_subjects: Array<{ subject_id: string; name: string }>;
}

export interface SubjectPassFailRow {
  subject_id: string;
  subject_name: string;
  appeared: number;
  passed: number;
  failed: number;
  absent: number;
  pass_pct: number;
  highest: number | null;
  average: number | null;
  grade_distribution: Record<string, number>;
}

export interface OverallPassFailRow {
  subject_id: null;
  subject_name: 'Overall';
  appeared: number;
  passed: number;
  failed: number;
  absent: number;
  pass_pct: number;
  highest: number | null;
  average: number | null;
  grade_distribution: Record<string, number>;
}

export interface ComponentPassFailRow {
  subject_id: string;
  subject_name: string;
  component_id: string;
  component_name: string;
  sequence: number;
  appeared: number;
  absent: number;
  below_pass: number | null;
  highest: number | null;
  average: number | null;
}

/** [997] Read-only analysis: merit list, defaulted list, per-subject and
 * per-component pass/fail breakdowns for an exam, all optionally section-
 * scoped. Every method here does query-builder aggregation — never
 * in-memory loops over marks (issue step 7's invariant) — and never writes. */
@Injectable()
export class AnalysisService {
  constructor(
    @InjectRepository(Exam)
    private readonly examRepo: Repository<Exam>,
    @InjectRepository(Result)
    private readonly resultRepo: Repository<Result>,
    @InjectRepository(ResultSubject)
    private readonly resultSubjectRepo: Repository<ResultSubject>,
    @InjectRepository(Mark)
    private readonly markRepo: Repository<Mark>,
  ) {}

  private async findExam(examId: string, tenantId: string): Promise<Exam> {
    const exam = await this.examRepo.findOne({
      where: { id: examId, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!exam) {
      throw new NotFoundException(`Exam with ID "${examId}" not found`);
    }
    return exam;
  }

  private meritQueryBuilder(examId: string, tenantId: string, sectionId?: string) {
    const qb = this.resultRepo
      .createQueryBuilder('r')
      .innerJoin(Student, 's', 's.id = r.student_id')
      .leftJoin(ClassSection, 'cs', 'cs.id = r.section_id')
      .where('r.exam_id = :examId', { examId })
      .andWhere('r.tenant_id = :tenantId', { tenantId })
      .andWhere('r.deleted_at IS NULL');
    if (sectionId) {
      qb.andWhere('r.section_id = :sectionId', { sectionId });
    }
    return qb;
  }

  private mapMeritRow(raw: Record<string, unknown>): MeritRow {
    return {
      student_id: raw.student_id as string,
      roll_number: Number(raw.roll_number),
      full_name: raw.full_name as string,
      section_id: (raw.section_id as string) ?? null,
      section_name: (raw.section_name as string) ?? null,
      total_marks: Number(raw.total_marks),
      gpa: Number(raw.gpa),
      grade: raw.grade as string,
      position: raw.position === null ? null : Number(raw.position),
      section_position: raw.section_position === null ? null : Number(raw.section_position),
      is_fail: raw.is_fail as boolean,
    };
  }

  /** Step 2: the merit list, or `{status, rows: []}` while the exam is
   * still DRAFT (nothing has been processed yet). */
  async getMerit(
    examId: string,
    tenantId: string,
    sectionId?: string,
  ): Promise<{ status: ExamStatus; rows: MeritRow[] }> {
    const exam = await this.findExam(examId, tenantId);
    if (exam.status === ExamStatus.DRAFT) {
      return { status: exam.status, rows: [] };
    }

    const qb = this.meritQueryBuilder(examId, tenantId, sectionId)
      .select('r.student_id', 'student_id')
      .addSelect('s.roll_number', 'roll_number')
      .addSelect('s.full_name', 'full_name')
      .addSelect('r.section_id', 'section_id')
      .addSelect('cs.section_name', 'section_name')
      .addSelect('r.total_marks', 'total_marks')
      .addSelect('r.gpa', 'gpa')
      .addSelect('r.grade', 'grade')
      .addSelect('r.position', 'position')
      .addSelect('r.section_position', 'section_position')
      .addSelect('r.is_fail', 'is_fail');

    if (sectionId) {
      qb.orderBy('r.section_position', 'ASC', 'NULLS LAST').addOrderBy('s.full_name', 'ASC');
    } else {
      qb.orderBy('r.position', 'ASC', 'NULLS LAST').addOrderBy('s.full_name', 'ASC');
    }

    const raw = await qb.getRawMany();
    return { status: exam.status, rows: raw.map((r) => this.mapMeritRow(r)) };
  }

  /** Step 3 (D3): merit rows where the student either failed overall or was
   * marked ABS in any subject, plus the reasons for each. */
  async getDefaulted(
    examId: string,
    tenantId: string,
    sectionId?: string,
  ): Promise<{ status: ExamStatus; rows: DefaultedRow[] }> {
    const exam = await this.findExam(examId, tenantId);
    if (exam.status === ExamStatus.DRAFT) {
      return { status: exam.status, rows: [] };
    }

    const qb = this.meritQueryBuilder(examId, tenantId, sectionId)
      .select('r.id', 'result_id')
      .addSelect('r.student_id', 'student_id')
      .addSelect('s.roll_number', 'roll_number')
      .addSelect('s.full_name', 'full_name')
      .addSelect('r.section_id', 'section_id')
      .addSelect('cs.section_name', 'section_name')
      .addSelect('r.total_marks', 'total_marks')
      .addSelect('r.gpa', 'gpa')
      .addSelect('r.grade', 'grade')
      .addSelect('r.position', 'position')
      .addSelect('r.section_position', 'section_position')
      .addSelect('r.is_fail', 'is_fail')
      .andWhere(
        `(r.is_fail = true OR EXISTS (
           SELECT 1 FROM result_subjects rs
           WHERE rs.result_id = r.id AND rs.deleted_at IS NULL AND rs.grade = 'ABS'
         ))`,
      );

    if (sectionId) {
      qb.orderBy('r.section_position', 'ASC', 'NULLS LAST').addOrderBy('s.full_name', 'ASC');
    } else {
      qb.orderBy('r.position', 'ASC', 'NULLS LAST').addOrderBy('s.full_name', 'ASC');
    }

    const raw = await qb.getRawMany();
    if (raw.length === 0) return { status: exam.status, rows: [] };

    const resultIds = raw.map((r) => r.result_id as string);
    const subjectRows = await this.resultSubjectRepo
      .createQueryBuilder('rs')
      .innerJoin(Subject, 'sub', 'sub.id = rs.subject_id')
      .where('rs.result_id IN (:...resultIds)', { resultIds })
      .andWhere('rs.tenant_id = :tenantId', { tenantId })
      .andWhere('rs.deleted_at IS NULL')
      .andWhere(`(rs.is_fail = true OR rs.grade = 'ABS')`)
      .select('rs.result_id', 'result_id')
      .addSelect('rs.subject_id', 'subject_id')
      .addSelect('sub.name_en', 'name')
      .addSelect('rs.grade', 'grade')
      .getRawMany();

    const failedBy = new Map<string, Array<{ subject_id: string; name: string }>>();
    const absentBy = new Map<string, Array<{ subject_id: string; name: string }>>();
    for (const s of subjectRows) {
      const bucket = s.grade === 'ABS' ? absentBy : failedBy;
      const list = bucket.get(s.result_id as string) ?? [];
      list.push({ subject_id: s.subject_id as string, name: s.name as string });
      bucket.set(s.result_id as string, list);
    }

    const rows: DefaultedRow[] = raw.map((r) => ({
      ...this.mapMeritRow(r),
      failed_subjects: failedBy.get(r.result_id as string) ?? [],
      absent_subjects: absentBy.get(r.result_id as string) ?? [],
    }));

    return { status: exam.status, rows };
  }

  /** Step 4 (D4, D16): per-subject pass/fail breakdown, plus one `overall`
   * row computed from `results.is_fail`. */
  async getPassFail(
    examId: string,
    tenantId: string,
    sectionId?: string,
  ): Promise<{ status: ExamStatus; subjects: SubjectPassFailRow[]; overall: OverallPassFailRow }> {
    const exam = await this.findExam(examId, tenantId);
    if (exam.status === ExamStatus.DRAFT) {
      return {
        status: exam.status,
        subjects: [],
        overall: {
          subject_id: null,
          subject_name: 'Overall',
          appeared: 0,
          passed: 0,
          failed: 0,
          absent: 0,
          pass_pct: 0,
          highest: null,
          average: null,
          grade_distribution: {},
        },
      };
    }

    const baseSubjectQb = () => {
      const qb = this.resultSubjectRepo
        .createQueryBuilder('rs')
        .innerJoin(Result, 'r', 'r.id = rs.result_id')
        .innerJoin(Subject, 'sub', 'sub.id = rs.subject_id')
        .where('r.exam_id = :examId', { examId })
        .andWhere('r.tenant_id = :tenantId', { tenantId })
        .andWhere('r.deleted_at IS NULL')
        .andWhere('rs.deleted_at IS NULL');
      if (sectionId) qb.andWhere('r.section_id = :sectionId', { sectionId });
      return qb;
    };

    const subjectRaw = await baseSubjectQb()
      .select('rs.subject_id', 'subject_id')
      .addSelect('sub.name_en', 'subject_name')
      .addSelect(`COUNT(*) FILTER (WHERE rs.grade <> 'ABS')`, 'appeared')
      .addSelect(`COUNT(*) FILTER (WHERE rs.grade <> 'ABS' AND rs.is_fail = false)`, 'passed')
      .addSelect(`COUNT(*) FILTER (WHERE rs.grade <> 'ABS' AND rs.is_fail = true)`, 'failed')
      .addSelect(`COUNT(*) FILTER (WHERE rs.grade = 'ABS')`, 'absent')
      .addSelect(`MAX(rs.obtained) FILTER (WHERE rs.grade <> 'ABS')`, 'highest')
      .addSelect(`AVG(rs.obtained) FILTER (WHERE rs.grade <> 'ABS')`, 'average')
      .groupBy('rs.subject_id')
      .addGroupBy('sub.name_en')
      .orderBy('sub.name_en', 'ASC')
      .getRawMany();

    const distRaw = await baseSubjectQb()
      .select('rs.subject_id', 'subject_id')
      .addSelect('rs.grade', 'grade')
      .addSelect('COUNT(*)', 'count')
      .groupBy('rs.subject_id')
      .addGroupBy('rs.grade')
      .getRawMany();
    const distBySubject = new Map<string, Record<string, number>>();
    for (const d of distRaw) {
      const map = distBySubject.get(d.subject_id as string) ?? {};
      map[d.grade as string] = Number(d.count);
      distBySubject.set(d.subject_id as string, map);
    }

    const subjects: SubjectPassFailRow[] = subjectRaw.map((s) => {
      const appeared = Number(s.appeared);
      const passed = Number(s.passed);
      return {
        subject_id: s.subject_id as string,
        subject_name: s.subject_name as string,
        appeared,
        passed,
        failed: Number(s.failed),
        absent: Number(s.absent),
        pass_pct: appeared > 0 ? Math.round((passed / appeared) * 1000) / 10 : 0,
        highest: s.highest === null ? null : Number(s.highest),
        average: s.average === null ? null : Math.round(Number(s.average) * 100) / 100,
        grade_distribution: distBySubject.get(s.subject_id as string) ?? {},
      };
    });

    const baseOverallQb = () => {
      const qb = this.resultRepo
        .createQueryBuilder('r')
        .where('r.exam_id = :examId', { examId })
        .andWhere('r.tenant_id = :tenantId', { tenantId })
        .andWhere('r.deleted_at IS NULL');
      if (sectionId) qb.andWhere('r.section_id = :sectionId', { sectionId });
      return qb;
    };

    const overallRaw = await baseOverallQb()
      .select('COUNT(*)', 'appeared')
      .addSelect(`COUNT(*) FILTER (WHERE r.is_fail = false)`, 'passed')
      .addSelect(`COUNT(*) FILTER (WHERE r.is_fail = true)`, 'failed')
      .addSelect('MAX(r.total_marks)', 'highest')
      .addSelect('AVG(r.total_marks)', 'average')
      .getRawOne();

    const overallDistRaw = await baseOverallQb()
      .select('r.grade', 'grade')
      .addSelect('COUNT(*)', 'count')
      .groupBy('r.grade')
      .getRawMany();
    const overallDist: Record<string, number> = {};
    for (const d of overallDistRaw) overallDist[d.grade as string] = Number(d.count);

    const overallAppeared = Number(overallRaw.appeared);
    const overallPassed = Number(overallRaw.passed);
    const overall: OverallPassFailRow = {
      subject_id: null,
      subject_name: 'Overall',
      appeared: overallAppeared,
      passed: overallPassed,
      failed: Number(overallRaw.failed),
      absent: 0,
      pass_pct: overallAppeared > 0 ? Math.round((overallPassed / overallAppeared) * 1000) / 10 : 0,
      highest: overallRaw.highest === null ? null : Number(overallRaw.highest),
      average:
        overallRaw.average === null ? null : Math.round(Number(overallRaw.average) * 100) / 100,
      grade_distribution: overallDist,
    };

    return { status: exam.status, subjects, overall };
  }

  /** Step 5 (D4): per subject × component breakdown from `marks`, section
   * taken from that student's `results.section_id`. Ordered by subject
   * name then component `sequence` — the exact "subject order" the class
   * offers them in isn't modeled on `ExamComponent`, so subject name is
   * the closest stable ordering available (ponytail: alphabetical by
   * subject, upgrade to `class_subjects.sequence` if a real ordering need
   * shows up). */
  async getPassFailComponents(
    examId: string,
    tenantId: string,
    sectionId?: string,
  ): Promise<{ status: ExamStatus; rows: ComponentPassFailRow[] }> {
    const exam = await this.findExam(examId, tenantId);
    if (exam.status === ExamStatus.DRAFT) {
      return { status: exam.status, rows: [] };
    }

    const qb = this.markRepo
      .createQueryBuilder('m')
      .innerJoin(ExamComponent, 'ec', 'ec.id = m.component_id')
      .innerJoin(Subject, 'sub', 'sub.id = ec.subject_id')
      .innerJoin(
        Result,
        'r',
        'r.exam_id = m.exam_id AND r.student_id = m.student_id AND r.tenant_id = m.tenant_id AND r.deleted_at IS NULL',
      )
      .where('m.exam_id = :examId', { examId })
      .andWhere('m.tenant_id = :tenantId', { tenantId })
      .andWhere('ec.deleted_at IS NULL');
    if (sectionId) qb.andWhere('r.section_id = :sectionId', { sectionId });

    const raw = await qb
      .select('ec.subject_id', 'subject_id')
      .addSelect('sub.name_en', 'subject_name')
      .addSelect('ec.id', 'component_id')
      .addSelect('ec.name', 'component_name')
      .addSelect('ec.sequence', 'sequence')
      .addSelect('ec.pass_marks', 'pass_marks')
      .addSelect(`COUNT(*) FILTER (WHERE m.status = 'PRESENT')`, 'appeared')
      .addSelect(`COUNT(*) FILTER (WHERE m.status <> 'PRESENT')`, 'absent')
      .addSelect(
        `COUNT(*) FILTER (WHERE m.status = 'PRESENT' AND ec.pass_marks IS NOT NULL AND m.value < ec.pass_marks)`,
        'below_pass',
      )
      .addSelect(`MAX(m.value) FILTER (WHERE m.status = 'PRESENT')`, 'highest')
      .addSelect(`AVG(m.value) FILTER (WHERE m.status = 'PRESENT')`, 'average')
      .groupBy('ec.subject_id')
      .addGroupBy('sub.name_en')
      .addGroupBy('ec.id')
      .addGroupBy('ec.name')
      .addGroupBy('ec.sequence')
      .addGroupBy('ec.pass_marks')
      .orderBy('sub.name_en', 'ASC')
      .addOrderBy('ec.sequence', 'ASC')
      .getRawMany();

    const rows: ComponentPassFailRow[] = raw.map((c) => ({
      subject_id: c.subject_id as string,
      subject_name: c.subject_name as string,
      component_id: c.component_id as string,
      component_name: c.component_name as string,
      sequence: Number(c.sequence),
      appeared: Number(c.appeared),
      absent: Number(c.absent),
      below_pass: c.pass_marks === null ? null : Number(c.below_pass),
      highest: c.highest === null ? null : Number(c.highest),
      average: c.average === null ? null : Math.round(Number(c.average) * 100) / 100,
    }));

    return { status: exam.status, rows };
  }
}
