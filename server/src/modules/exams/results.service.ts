import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository, IsNull, In, Not } from 'typeorm';
import {
  AuditAction,
  EnrollmentStatus,
  ExamComponentSource,
  ExamStatus,
  MarkStatus,
} from '@biddaloy/shared';
import { Exam } from './entities/exam.entity';
import { Result } from './entities/result.entity';
import { ResultSubject } from './entities/result-subject.entity';
import { Mark } from './entities/mark.entity';
import { ExamComponent } from './entities/exam-component.entity';
import { ClassSubject } from '../academics/entities/class-subject.entity';
import { Subject } from '../academics/entities/subject.entity';
import { Student } from '../students/entities/student.entity';
import { Enrollment } from '../students/entities/enrollment.entity';
import { StudentSubjectChoice } from '../students/entities/student-subject-choice.entity';
import { GradingScale } from '../grading/entities/grading-scale.entity';
import { School } from '../schools/entities/school.entity';
import { buildIssuerSnapshot, type IssuerSnapshot } from '../schools/profile/issuer-snapshot';
import { buildLogoUrl } from '../schools/profile/logo-key';
import { GradingBand } from '../grading/entities/grading-band.entity';
import { resolveScale, gradeFor } from '../grading/scale-lookup';
import {
  computeSubjectTotal,
  gradeSubjectTotal,
  combineSubjects,
  rankByMerit,
  Band,
  ComponentInput,
  SubjectResult,
} from './result-rules';
import { AttendanceComponentService } from './attendance-component.service';
import { MarkGridService } from './mark-grid.service';
import { AuditService } from '../audit/audit.service';
import { RequestContext } from '../../common/request-context.util';
import type { ApprovalContext } from '../auth/guards/approval.guard';

/** The rule engine's own version — stamped on every `Result` row (D19) so
 * a later change to `result-rules.ts` can be told apart from an
 * old computation without touching the row's other fields. Bump this
 * whenever `computeSubjectTotal`/`combineSubjects`'s actual arithmetic
 * changes, not for a comment or a refactor. */
export const RULE_VERSION = 'nctb-v2';

/**
 * [pr-fix #945] The exam-level lock every result-changing path shares.
 * `process`, `publish`, `reopen` and the mark-change recompute take it
 * FOR UPDATE and re-check `status` under it, so none of them can act on
 * a status another has just changed. Mark writes take it FOR SHARE
 * (`MarksService`): autosaves on different grids don't block each other,
 * but a publish can't commit while a mark write is mid-transaction.
 * Lock order is always exam, then grid (`lockGrid`).
 */
export async function lockExam(
  manager: EntityManager,
  examId: string,
  tenantId: string,
  mode: 'pessimistic_write' | 'pessimistic_read' = 'pessimistic_write',
): Promise<Exam> {
  const exam = await manager.getRepository(Exam).findOne({
    where: { id: examId, tenant_id: tenantId, deleted_at: IsNull() },
    lock: { mode },
  });
  if (!exam) {
    throw new NotFoundException(`Exam with ID "${examId}" not found`);
  }
  return exam;
}

interface ComputedStudentResult {
  student_id: string;
  section_id: string | null;
  total_marks: number;
  gpa: number;
  grade: string;
  is_fail: boolean;
  subjects: Array<{
    subject_id: string;
    obtained: number;
    full_marks: number;
    grade: string;
    gpa: number | null;
    is_fail: boolean;
    is_fourth_subject: boolean;
  }>;
}

@Injectable()
export class ResultsService {
  constructor(
    @InjectRepository(Exam)
    private readonly examRepo: Repository<Exam>,
    @InjectRepository(Result)
    private readonly resultRepo: Repository<Result>,
    @InjectRepository(ResultSubject)
    private readonly resultSubjectRepo: Repository<ResultSubject>,
    @InjectRepository(Mark)
    private readonly markRepo: Repository<Mark>,
    @InjectRepository(ExamComponent)
    private readonly componentRepo: Repository<ExamComponent>,
    @InjectRepository(ClassSubject)
    private readonly classSubjectRepo: Repository<ClassSubject>,
    @InjectRepository(Subject)
    private readonly subjectRepo: Repository<Subject>,
    @InjectRepository(Student)
    private readonly studentRepo: Repository<Student>,
    @InjectRepository(Enrollment)
    private readonly enrollmentRepo: Repository<Enrollment>,
    @InjectRepository(StudentSubjectChoice)
    private readonly choiceRepo: Repository<StudentSubjectChoice>,
    @InjectRepository(GradingScale)
    private readonly scaleRepo: Repository<GradingScale>,
    @InjectRepository(GradingBand)
    private readonly bandRepo: Repository<GradingBand>,
    @InjectRepository(School)
    private readonly schoolRepo: Repository<School>,
    private readonly attendanceComponentService: AttendanceComponentService,
    private readonly gridService: MarkGridService,
    private readonly auditService: AuditService,
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

  private toRuleBand(band: GradingBand): Band {
    return {
      percent_from: band.percent_from,
      percent_to: band.percent_to,
      grade: band.grade,
      gpa: band.gpa === null ? null : Number(band.gpa),
      is_fail: band.is_fail,
    };
  }

  /** The overall grade for a computed GPA is looked up against the same
   * scale, keyed by GPA rather than percent (the certificate's grade
   * always mirrors the GPA scale directly). */
  private gradeForGpa(bands: Band[], gpa: number): Band | null {
    const eligible = bands.filter((b) => b.gpa !== null && b.gpa <= gpa);
    if (eligible.length === 0) return null;
    return eligible.reduce((best, b) => ((b.gpa as number) > (best.gpa as number) ? b : best));
  }

  /**
   * Computes every enrolled student's result for one exam. Pure data
   * assembly + `result-rules.ts` — the only side effect here is the
   * `AttendanceComponentService` calls for `DERIVED` components, which
   * are themselves read-only. Callers (`process`, `recomputeIfProcessed`)
   * decide what to do with the output.
   */
  private async computeAll(exam: Exam, tenantId: string): Promise<ComputedStudentResult[]> {
    const scales = await this.scaleRepo.find({
      where: { tenant_id: tenantId, deleted_at: IsNull() },
    });
    const scale = resolveScale(scales, exam.academic_year_id, exam.class_id);
    if (!scale) {
      throw new ConflictException(
        `No grading scale found for academic year "${exam.academic_year_id}" (or class "${exam.class_id}").`,
      );
    }
    const bandRows = await this.bandRepo.find({
      where: { scale_id: scale.id, tenant_id: tenantId, deleted_at: IsNull() },
    });
    const bands = bandRows.map((b) => this.toRuleBand(b));

    // D17: the exam's cohort is whoever holds an ACTIVE enrollment for its
    // own (academic_year_id, class_id) — not `Student.class_section_id`,
    // which is the student's CURRENT placement and drifts away from an old
    // exam's year/class after promotion. Reprocessing an old exam must keep
    // finding the same students it was processed for originally.
    const enrollments = await this.enrollmentRepo.find({
      where: {
        tenant_id: tenantId,
        academic_year_id: exam.academic_year_id,
        class_id: exam.class_id,
        enrollment_status: EnrollmentStatus.ACTIVE,
      },
    });
    const students =
      enrollments.length === 0
        ? []
        : await this.studentRepo.find({
            where: {
              id: In(enrollments.map((e) => e.student_id)),
              tenant_id: tenantId,
              deleted_at: IsNull(),
            },
          });
    const sectionByStudent = new Map(enrollments.map((e) => [e.student_id, e.section_id]));

    const classSubjects = await this.classSubjectRepo.find({
      where: {
        class_id: exam.class_id,
        academic_year_id: exam.academic_year_id,
        tenant_id: tenantId,
        deleted_at: IsNull(),
      },
    });

    const choices =
      students.length === 0
        ? []
        : await this.choiceRepo.find({
            where: {
              student_id: In(students.map((s) => s.id)),
              academic_year_id: exam.academic_year_id,
              tenant_id: tenantId,
            },
          });
    const choiceByStudentAndSubject = new Map(
      choices.map((c) => [`${c.student_id}:${c.class_subject_id}`, c]),
    );

    const components = await this.componentRepo.find({
      where: { exam_id: exam.id, tenant_id: tenantId, deleted_at: IsNull() },
    });
    const componentsBySubject = new Map<string, ExamComponent[]>();
    for (const c of components) {
      componentsBySubject.set(c.subject_id, [...(componentsBySubject.get(c.subject_id) ?? []), c]);
    }

    const marks = await this.markRepo.find({ where: { exam_id: exam.id, tenant_id: tenantId } });
    const markByKey = new Map(marks.map((m) => [`${m.student_id}:${m.component_id}`, m]));

    // DERIVED components are computed once per (section, component) —
    // never per student — and cached; `AttendanceComponentService`
    // already does the per-student work internally.
    const derivedCache = new Map<string, Map<string, string | null>>();
    async function derivedValuesFor(
      self: ResultsService,
      sectionId: string,
      component: ExamComponent,
    ): Promise<Map<string, string | null>> {
      const key = `${sectionId}:${component.id}`;
      const cached = derivedCache.get(key);
      if (cached) return cached;
      const result = await self.attendanceComponentService.computeForSection({
        examId: exam.id,
        sectionId,
        fullMarks: component.full_marks,
        tenantId,
      });
      derivedCache.set(key, result.valuesByStudent);
      return result.valuesByStudent;
    }

    const computed: ComputedStudentResult[] = [];
    for (const student of students) {
      const subjectResults: SubjectResult[] = [];
      const subjectDisplay: ComputedStudentResult['subjects'] = [];

      for (const classSubject of classSubjects) {
        if (classSubject.is_optional) {
          const choice = choiceByStudentAndSubject.get(`${student.id}:${classSubject.id}`);
          if (!choice) continue; // student never opted into this offering
        }
        const isFourth =
          classSubject.is_optional &&
          (choiceByStudentAndSubject.get(`${student.id}:${classSubject.id}`)?.is_fourth ?? false);

        const subjectComponents = componentsBySubject.get(classSubject.subject_id) ?? [];
        const inputs: ComponentInput[] = [];
        for (const component of subjectComponents) {
          if (component.source === ExamComponentSource.DERIVED) {
            const values = await derivedValuesFor(
              this,
              sectionByStudent.get(student.id)!,
              component,
            );
            const value = values.get(student.id) ?? null;
            // D11: unmeasurable (no term, or no attendance marked at
            // all) drops the component the same way EXEMPT does —
            // never a silent zero folded into the subject total.
            inputs.push({
              full_marks: Number(component.full_marks),
              value: value === null ? null : Number(value),
              status: value === null ? MarkStatus.EXEMPT : MarkStatus.PRESENT,
            });
            continue;
          }
          const mark = markByKey.get(`${student.id}:${component.id}`);
          // A component with no Mark row at all (never entered) is
          // treated as ABSENT, not silently dropped — `process()`
          // refuses to run while any grid is still DRAFT (issue step 4),
          // so this should only ever fire when forced past that guard.
          inputs.push({
            full_marks: Number(component.full_marks),
            value: mark && mark.value !== null ? Number(mark.value) : null,
            status: mark?.status ?? MarkStatus.ABSENT,
          });
        }

        const total = computeSubjectTotal(inputs);
        const graded = gradeSubjectTotal(total, (percent) => gradeFor(bands, percent));
        subjectResults.push({
          subject_id: classSubject.subject_id,
          obtained: total.obtained,
          full_marks: total.full_marks,
          is_countable: !classSubject.is_graded_only,
          is_fourth_subject: isFourth,
          ...graded,
        });
        subjectDisplay.push({
          subject_id: classSubject.subject_id,
          obtained: total.obtained,
          full_marks: total.full_marks,
          grade: graded.grade,
          gpa: graded.gpa,
          is_fail: graded.is_fail,
          is_fourth_subject: isFourth,
        });
      }

      const overall = combineSubjects(subjectResults, (gpa) => this.gradeForGpa(bands, gpa));
      computed.push({
        student_id: student.id,
        section_id: sectionByStudent.get(student.id) ?? null,
        total_marks: overall.total_marks,
        gpa: overall.gpa,
        grade: overall.grade,
        is_fail: overall.is_fail,
        subjects: subjectDisplay,
      });
    }

    // Class position (D2/D18): merit rank across the whole class.
    const positions = rankByMerit(
      computed.map((c) => ({
        student_id: c.student_id,
        gpa: c.gpa,
        total_marks: c.total_marks,
        is_fail: c.is_fail,
      })),
    );

    // Section position: merit rank within each section separately —
    // `sectionByStudent` (sourced from Enrollment) groups the same
    // `computed` rows by the section each student is actually enrolled
    // in, so a student's section rank never leaks across sections.
    const bySection = new Map<string, ComputedStudentResult[]>();
    for (const c of computed) {
      if (c.section_id === null) continue;
      bySection.set(c.section_id, [...(bySection.get(c.section_id) ?? []), c]);
    }
    const sectionPositions = new Map<string, number | null>();
    for (const sectionStudents of bySection.values()) {
      const ranked = rankByMerit(
        sectionStudents.map((c) => ({
          student_id: c.student_id,
          gpa: c.gpa,
          total_marks: c.total_marks,
          is_fail: c.is_fail,
        })),
      );
      for (const [studentId, position] of ranked) {
        sectionPositions.set(studentId, position);
      }
    }

    return computed.map(
      (c) =>
        ({
          ...c,
          position: positions.get(c.student_id) ?? null,
          section_position: sectionPositions.get(c.student_id) ?? null,
        }) as any,
    );
  }

  /** Soft-deletes every active result for the exam — including students
   * no longer in `computed` (e.g. since made INACTIVE), whose old row would
   * otherwise survive to be published and texted — then inserts `computed`. */
  private async replaceResults(
    manager: EntityManager,
    exam: Exam,
    computed: ComputedStudentResult[],
    scaleId: string,
    scaleRevision: number,
    tenantId: string,
  ): Promise<void> {
    const resultRepo = manager.getRepository(Result);
    const resultSubjectRepo = manager.getRepository(ResultSubject);

    const existing = await resultRepo.find({
      where: { exam_id: exam.id, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (existing.length > 0) {
      await resultSubjectRepo.softDelete({
        result_id: In(existing.map((r) => r.id)),
        tenant_id: tenantId,
      });
      await resultRepo.softDelete({ id: In(existing.map((r) => r.id)), tenant_id: tenantId });
    }

    const now = new Date();
    for (const c of computed as Array<
      ComputedStudentResult & { position: number | null; section_position: number | null }
    >) {
      const result = await resultRepo.save(
        resultRepo.create({
          exam_id: exam.id,
          student_id: c.student_id,
          total_marks: c.total_marks.toFixed(2),
          gpa: c.gpa.toFixed(2),
          grade: c.grade,
          position: c.position,
          section_id: c.section_id,
          section_position: c.section_position,
          is_fail: c.is_fail,
          grading_scale_id: scaleId,
          grading_scale_revision: scaleRevision,
          rule_version: RULE_VERSION,
          computed_at: now,
          published_at: null,
          tenant_id: tenantId,
        }),
      );

      for (const s of c.subjects) {
        await resultSubjectRepo.save(
          resultSubjectRepo.create({
            result_id: result.id,
            subject_id: s.subject_id,
            obtained: s.obtained.toFixed(2),
            grade: s.grade,
            gpa: (s.gpa ?? 0).toFixed(2), // stored as 0.00 placeholder; excluded from the average regardless (see result-rules.ts)
            is_fail: s.is_fail,
            is_fourth_subject: s.is_fourth_subject,
            tenant_id: tenantId,
          }),
        );
      }
    }
  }

  /** Issue step 4: computes and stores every enrolled student's result,
   * moving the exam DRAFT/PROCESSED -> PROCESSED. Refuses while any grid
   * is still short of SUBMITTED unless `force` is set, in which case the
   * override is itself audited (`forced: true` on the same record). */
  async process(
    examId: string,
    tenantId: string,
    userId: string,
    force = false,
    context: RequestContext = { ip: null, userAgent: null },
  ): Promise<{ processed: number }> {
    const exam = await this.findExam(examId, tenantId);
    if (exam.status === ExamStatus.PUBLISHED) {
      throw new ConflictException(
        `Exam "${examId}" is already published — reopen it (step-up approval) before reprocessing.`,
      );
    }

    if (!force) {
      const { outstanding } = await this.gridService.progress(examId, tenantId);
      if (outstanding.length > 0) {
        throw new ConflictException(
          `Cannot process exam "${examId}": ${outstanding.length} grid(s) are not SUBMITTED ` +
            `(section ${outstanding[0].section_id}, subject ${outstanding[0].subject_id}, and ${outstanding.length - 1} more). ` +
            'Pass force=true to override — the override is audited.',
        );
      }
    }

    const scales = await this.scaleRepo.find({
      where: { tenant_id: tenantId, deleted_at: IsNull() },
    });
    const scale = resolveScale(scales, exam.academic_year_id, exam.class_id);
    if (!scale) {
      throw new ConflictException(
        `No grading scale found for academic year "${exam.academic_year_id}".`,
      );
    }

    const computed = await this.examRepo.manager.transaction(async (manager) => {
      // Re-checked under the exam lock: a publish that committed since the
      // check above must win, not be overwritten by unpublished rows.
      const locked = await lockExam(manager, examId, tenantId);
      if (locked.status === ExamStatus.PUBLISHED) {
        throw new ConflictException(
          `Exam "${examId}" is already published — reopen it (step-up approval) before reprocessing.`,
        );
      }
      // Computed after the lock: mark writes hold it FOR SHARE, so none
      // can commit between this read and the write below.
      const rows = await this.computeAll(locked, tenantId);
      await this.replaceResults(manager, locked, rows, scale.id, scale.revision, tenantId);

      await this.auditService.record(
        {
          action: AuditAction.UPDATE,
          entity_type: 'Exam',
          entity_id: examId,
          tenant_id: tenantId,
          performed_by_user_id: userId,
          ip_address: context.ip,
          user_agent: context.userAgent,
          old_values: { status: locked.status },
          new_values: { status: ExamStatus.PROCESSED, student_count: rows.length, forced: force },
        },
        manager,
      );
      await manager
        .getRepository(Exam)
        .update({ id: examId, tenant_id: tenantId }, { status: ExamStatus.PROCESSED });
      return rows;
    });
    return { processed: computed.length };
  }

  /** Issue step 6: a mark change while the exam is PROCESSED (not yet
   * PUBLISHED) invalidates and recomputes the class's results. Called by
   * `MarksService` after a batch write commits. A no-op once PUBLISHED —
   * marks are frozen there; a change requires `reopen()`. */
  /** [pr-fix #945] Takes the whole batch's distinct student IDs, not one —
   * `computeAll` ranks the *entire class* internally regardless of how
   * many students changed, so calling this once per student in a batch
   * (as `MarksService.upsertBatch` used to) ran the full-class computation
   * N times on the request thread and, worse, only ever persisted one
   * student's row per call — every other student whose rank shifted as a
   * side effect kept a stale `position`. One call, one `computeAll`, one
   * transaction rewriting every affected row. */
  async recomputeIfProcessed(
    examId: string,
    studentIds: string[],
    tenantId: string,
    userId: string,
    context: RequestContext = { ip: null, userAgent: null },
  ): Promise<void> {
    if (studentIds.length === 0) return;

    await this.examRepo.manager.transaction(async (manager) => {
      // Status re-checked under the exam lock, not before it — otherwise a
      // publish committing in between would have its published rows
      // replaced by unpublished ones. Concurrent recomputes queue here too
      // instead of racing on the active (exam_id, student_id) index.
      const exam = await lockExam(manager, examId, tenantId);
      if (exam.status !== ExamStatus.PROCESSED) return;

      const scales = await this.scaleRepo.find({
        where: { tenant_id: tenantId, deleted_at: IsNull() },
      });
      const scale = resolveScale(scales, exam.academic_year_id, exam.class_id);
      if (!scale) return;

      // Rewrite every student's row, not just the batch's — a mark change
      // for one student can shift another's `position` (D18) even though
      // that other student's own marks never changed.
      const computed = await this.computeAll(exam, tenantId);
      await this.replaceResults(manager, exam, computed, scale.id, scale.revision, tenantId);

      await this.auditService.record(
        {
          action: AuditAction.UPDATE,
          entity_type: 'Result',
          entity_id: exam.id,
          tenant_id: tenantId,
          performed_by_user_id: userId,
          ip_address: context.ip,
          user_agent: context.userAgent,
          old_values: null,
          new_values: { recomputed_students: computed.map((c) => c.student_id) },
        },
        manager,
      );
    });
  }

  /** Issue step 7: PROCESSED -> PUBLISHED, stamping `published_at` on
   * the exam and every result row. */
  async publish(
    examId: string,
    tenantId: string,
    userId: string,
    context: RequestContext = { ip: null, userAgent: null },
  ): Promise<void> {
    const exam = await this.findExam(examId, tenantId);
    if (exam.status !== ExamStatus.PROCESSED) {
      throw new ConflictException(
        `Exam "${examId}" must be PROCESSED before it can be published (current: ${exam.status}).`,
      );
    }

    await this.examRepo.manager.transaction(async (manager) => {
      const locked = await lockExam(manager, examId, tenantId);
      if (locked.status !== ExamStatus.PROCESSED) {
        throw new ConflictException(
          `Exam "${examId}" must be PROCESSED before it can be published (current: ${locked.status}).`,
        );
      }
      const now = new Date();
      await manager
        .getRepository(Exam)
        .update(
          { id: examId, tenant_id: tenantId },
          { status: ExamStatus.PUBLISHED, published_at: now },
        );
      await manager
        .getRepository(Result)
        .update({ exam_id: examId, tenant_id: tenantId }, { published_at: now });

      await this.auditService.record(
        {
          action: AuditAction.UPDATE,
          entity_type: 'Exam',
          entity_id: examId,
          tenant_id: tenantId,
          performed_by_user_id: userId,
          ip_address: context.ip,
          user_agent: context.userAgent,
          old_values: { status: ExamStatus.PROCESSED },
          new_values: { status: ExamStatus.PUBLISHED },
        },
        manager,
      );
    });
  }

  /** Issue step 7: PUBLISHED -> PROCESSED, behind `@RequireApproval`
   * (`RESULTS_REOPEN`) at the controller — this method assumes the
   * approval already happened and just does the write + audit. */
  async reopen(
    examId: string,
    tenantId: string,
    userId: string,
    context: RequestContext = { ip: null, userAgent: null },
    approval?: ApprovalContext,
  ): Promise<void> {
    const exam = await this.findExam(examId, tenantId);
    if (exam.status !== ExamStatus.PUBLISHED) {
      throw new ConflictException(`Exam "${examId}" is not published (current: ${exam.status}).`);
    }

    await this.examRepo.manager.transaction(async (manager) => {
      const locked = await lockExam(manager, examId, tenantId);
      if (locked.status !== ExamStatus.PUBLISHED) {
        throw new ConflictException(
          `Exam "${examId}" is not published (current: ${locked.status}).`,
        );
      }
      await manager
        .getRepository(Exam)
        .update(
          { id: examId, tenant_id: tenantId },
          { status: ExamStatus.PROCESSED, published_at: null },
        );
      await manager
        .getRepository(Result)
        .update({ exam_id: examId, tenant_id: tenantId }, { published_at: null });

      if (approval) {
        await this.auditService.recordApproved(
          {
            action: AuditAction.UPDATE,
            entity_type: 'Exam',
            entity_id: examId,
            tenant_id: tenantId,
            performed_by_user_id: userId,
            approved_by_user_id: approval.approverId,
            approval_scope: approval.scope,
            ip_address: context.ip,
            user_agent: context.userAgent,
            old_values: { status: ExamStatus.PUBLISHED },
            new_values: { status: ExamStatus.PROCESSED },
          },
          manager,
        );
        return;
      }
      await this.auditService.record(
        {
          action: AuditAction.UPDATE,
          entity_type: 'Exam',
          entity_id: examId,
          tenant_id: tenantId,
          performed_by_user_id: userId,
          ip_address: context.ip,
          user_agent: context.userAgent,
          old_values: { status: ExamStatus.PUBLISHED },
          new_values: { status: ExamStatus.PROCESSED },
        },
        manager,
      );
    });
  }

  /** [19.8.1] The results panel's per-student rows — not in the plan's own
   * `## Files` list, but nothing upstream of this ticket ever added a read
   * path for `results`/`result_subjects` (`process`/`publish`/`reopen`/`sms`
   * are all write-only), so the panel has nothing to fetch without it.
   * Reported as a plan divergence. Ordered by `position` (nulls last) so a
   * fresh page load already reads top-to-bottom. */
  async list(
    examId: string,
    tenantId: string,
  ): Promise<
    Array<{
      student_id: string;
      roll_number: number;
      full_name: string;
      total_marks: number;
      gpa: number;
      grade: string;
      position: number | null;
      section_id: string | null;
      section_position: number | null;
      is_fail: boolean;
    }>
  > {
    const results = await this.resultRepo.find({
      where: { exam_id: examId, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (results.length === 0) return [];
    const students = await this.studentRepo.find({
      where: { id: In(results.map((r) => r.student_id)), tenant_id: tenantId },
    });
    const studentById = new Map(students.map((s) => [s.id, s]));

    return results
      .map((r) => {
        const student = studentById.get(r.student_id);
        return {
          student_id: r.student_id,
          roll_number: student?.roll_number ?? 0,
          full_name: student?.full_name ?? '',
          total_marks: Number(r.total_marks),
          gpa: Number(r.gpa),
          grade: r.grade,
          position: r.position,
          section_id: r.section_id,
          section_position: r.section_position,
          is_fail: r.is_fail,
        };
      })
      .sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity));
  }

  /** [19.8.1] One student's result for the report card — the subject
   * breakdown plus each subject's component contributions (`obtained`
   * marks a `ResultSubject` row never stores per-component, so those come
   * from `Mark`/`ExamComponent` directly, same sources `computeAll` reads
   * from). The grading scale's legend is fetched separately by the client
   * (`useGradingScale(result.grading_scale_id)`) — no need to duplicate it
   * here. */
  async getStudentResult(
    examId: string,
    studentId: string,
    tenantId: string,
  ): Promise<{
    student: { id: string; full_name: string; roll_number: number };
    result: {
      total_marks: number;
      gpa: number;
      grade: string;
      position: number | null;
      is_fail: boolean;
      grading_scale_id: string;
    };
    subjects: Array<{
      subject_id: string;
      subject_name: string;
      obtained: number;
      grade: string;
      gpa: number;
      is_fail: boolean;
      is_fourth_subject: boolean;
      components: Array<{ name: string; full_marks: number; obtained: number | null }>;
    }>;
  } | null> {
    const result = await this.resultRepo.findOne({
      where: { exam_id: examId, student_id: studentId, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!result) return null;

    const student = await this.studentRepo.findOne({
      where: { id: studentId, tenant_id: tenantId },
    });
    const resultSubjects = await this.resultSubjectRepo.find({
      where: { result_id: result.id, tenant_id: tenantId, deleted_at: IsNull() },
    });
    const subjectIds = resultSubjects.map((s) => s.subject_id);
    const subjects =
      subjectIds.length === 0
        ? []
        : await this.subjectRepo.find({ where: { id: In(subjectIds), tenant_id: tenantId } });
    const subjectNameById = new Map(subjects.map((s) => [s.id, s.name_en]));

    const components = await this.componentRepo.find({
      where: {
        exam_id: examId,
        subject_id: In(subjectIds.length ? subjectIds : ['']),
        tenant_id: tenantId,
        deleted_at: IsNull(),
      },
    });
    const marks = await this.markRepo.find({
      where: { exam_id: examId, student_id: studentId, tenant_id: tenantId },
    });
    const markByComponent = new Map(marks.map((m) => [m.component_id, m]));

    return {
      student: {
        id: studentId,
        full_name: student?.full_name ?? '',
        roll_number: student?.roll_number ?? 0,
      },
      result: {
        total_marks: Number(result.total_marks),
        gpa: Number(result.gpa),
        grade: result.grade,
        position: result.position,
        is_fail: result.is_fail,
        grading_scale_id: result.grading_scale_id,
      },
      subjects: resultSubjects.map((rs) => ({
        subject_id: rs.subject_id,
        subject_name: subjectNameById.get(rs.subject_id) ?? '',
        obtained: Number(rs.obtained),
        grade: rs.grade,
        gpa: Number(rs.gpa),
        is_fail: rs.is_fail,
        is_fourth_subject: rs.is_fourth_subject,
        components: components
          .filter((c) => c.subject_id === rs.subject_id)
          .map((c) => {
            const mark = markByComponent.get(c.id);
            return {
              name: c.name,
              full_marks: Number(c.full_marks),
              obtained: mark && mark.value !== null ? Number(mark.value) : null,
            };
          }),
      })),
    };
  }

  /** [19.9.1] The report-card data for one student/exam, for the family
   * portal (`StudentResultsController`) — `getStudentResult` plus the exam
   * name, the grading scale's legend, and the school's own identity
   * (`IssuerSnapshot`, live — not frozen — since a result has none of its
   * own the way an invoice/payment does), none of which `getStudentResult`
   * provides (staff already has `GET /grading/scales/:id` and `GET
   * /schools/me/profile`; a PARENT/STUDENT has neither, both ADMIN-only,
   * so this route bakes both in rather than requiring calls it could never
   * make).
   *
   * `publishedOnly` mirrors `listForStudent`'s gate: a PARENT/STUDENT
   * caller passes `true` and gets `null` for an unpublished (or
   * nonexistent) exam's result — same "absent, not greyed" contract
   * (D19) as the list. Staff pass `false`.
   */
  async getStudentResultCard(
    examId: string,
    studentId: string,
    tenantId: string,
    publishedOnly: boolean,
  ): Promise<{
    exam_name: string;
    student: { full_name: string; roll_number: number };
    result: {
      total_marks: number;
      gpa: number;
      grade: string;
      position: number | null;
      is_fail: boolean;
    };
    subjects: Array<{
      subject_name: string;
      obtained: number;
      grade: string;
      gpa: number;
      is_fail: boolean;
      is_fourth_subject: boolean;
      components: Array<{ name: string; full_marks: number; obtained: number | null }>;
    }>;
    legend: Array<{ grade: string; gpa: number | null; comment: string | null }>;
    issuer: IssuerSnapshot;
    logo_url: string | null;
  } | null> {
    const detail = await this.getStudentResult(examId, studentId, tenantId);
    if (!detail) return null;

    const exam = await this.examRepo.findOne({
      where: { id: examId, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!exam) return null;
    if (publishedOnly && exam.status !== ExamStatus.PUBLISHED) return null;

    const bandRows = await this.bandRepo.find({
      where: {
        scale_id: detail.result.grading_scale_id,
        tenant_id: tenantId,
        deleted_at: IsNull(),
      },
      order: { sequence: 'ASC' },
    });
    const school = await this.schoolRepo.findOne({ where: { id: tenantId } });
    if (!school) return null;

    return {
      exam_name: exam.name,
      student: detail.student,
      result: detail.result,
      subjects: detail.subjects,
      legend: bandRows.map((b) => ({
        grade: b.grade,
        gpa: b.gpa === null ? null : Number(b.gpa),
        comment: b.comment,
      })),
      issuer: buildIssuerSnapshot(school),
      logo_url: buildLogoUrl(school.id, school.logo_key),
    };
  }

  /** [19.9.1] Every exam this student has a `Result` row for, newest first
   * (`Exam.published_at` for a published exam, falling back to
   * `computed_at` for a processed-but-unpublished one a staff caller is
   * viewing). `publishedOnly` is the ONE gate between this and the family
   * portal: a guardian/student caller must never see an unpublished exam
   * in the list at all — not greyed out, absent (D19) — so it is filtered
   * here, server-side, rather than trusted to the client. Staff (the
   * results panel on student detail) pass `publishedOnly: false` and get
   * every exam including unpublished ones, so the panel can label each
   * one itself. */
  async listForStudent(
    studentId: string,
    tenantId: string,
    publishedOnly: boolean,
  ): Promise<
    Array<{
      exam_id: string;
      exam_name: string;
      exam_kind: string;
      published: boolean;
      total_marks: number;
      gpa: number;
      grade: string;
      position: number | null;
      is_fail: boolean;
    }>
  > {
    const where: Record<string, unknown> = {
      student_id: studentId,
      tenant_id: tenantId,
      deleted_at: IsNull(),
    };
    if (publishedOnly) {
      where.published_at = Not(IsNull());
    }
    const results = await this.resultRepo.find({ where: where as never });
    if (results.length === 0) return [];

    const exams = await this.examRepo.find({
      where: { id: In(results.map((r) => r.exam_id)), tenant_id: tenantId, deleted_at: IsNull() },
    });
    const examById = new Map(exams.map((e) => [e.id, e]));

    return results
      .map((r) => {
        const exam = examById.get(r.exam_id);
        return {
          exam_id: r.exam_id,
          exam_name: exam?.name ?? '',
          exam_kind: exam?.kind ?? '',
          published: r.published_at !== null,
          total_marks: Number(r.total_marks),
          gpa: Number(r.gpa),
          grade: r.grade,
          position: r.position,
          is_fail: r.is_fail,
          _sortDate: (r.published_at ?? r.computed_at).getTime(),
        };
      })
      .sort((a, b) => b._sortDate - a._sortDate)
      .map(({ _sortDate: _drop, ...row }) => row);
  }
}
