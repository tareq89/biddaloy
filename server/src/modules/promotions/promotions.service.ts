import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  UnprocessableEntityException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, IsNull, EntityManager } from 'typeorm';
import {
  PromotionOutcome,
  PromotionRunStatus,
  PlacementAlgorithm,
  ExamStatus,
  EnrollmentStatus,
  AuditAction,
  ApprovalScope,
  Permission,
  roleHasPermission,
} from '@biddaloy/shared';
import { PromotionRun } from './entities/promotion-run.entity';
import { PromotionEntry } from './entities/promotion-entry.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Exam } from '../exams/entities/exam.entity';
import { Result } from '../exams/entities/result.entity';
import { Student } from '../students/entities/student.entity';
import { Enrollment } from '../students/entities/enrollment.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { User } from '../users/entities/user.entity';
import { EnrollmentService } from '../enrollments/enrollments.service';
import { AuditService } from '../audit/audit.service';
import { ApprovalService } from '../auth/guards/approval.guard';
import { RequestContext } from '../../common/request-context.util';
import { CreatePromotionRunDto, PatchPromotionEntryDto } from './dto/promotions.dto';
import {
  suggestOutcome,
  meritOrder,
  place,
  assignRolls,
  type PlacementStudent,
  type PlacementSection,
} from './placement';

type BlockingReason = 'PICK_TARGET_CLASS' | 'TARGET_SECTIONS_MISSING' | 'RETAIN_CLASS_MISSING';

export interface TargetSuggestion {
  target_class: { id: string; name: string } | null;
  retain_class: { id: string; name: string } | null;
  sections: Array<{
    id: string;
    section_name: string;
    capacity: number | null;
    group_name: string | null;
  }>;
  blocking_reason?: BlockingReason;
}

interface CohortStudentStat {
  student_id: string;
  enrollment_id: string;
  section_id: string | null;
  group_name: string | null;
  passed_all: boolean;
  mean_gpa: number;
  total_marks_sum: number;
}

const AUTH_REQUEST_STUB: RequestContext = { ip: null, userAgent: null };

@Injectable()
export class PromotionsService {
  constructor(
    @InjectRepository(PromotionRun) private readonly runRepo: Repository<PromotionRun>,
    @InjectRepository(PromotionEntry) private readonly entryRepo: Repository<PromotionEntry>,
    @InjectRepository(Class) private readonly classRepo: Repository<Class>,
    @InjectRepository(ClassSection) private readonly sectionRepo: Repository<ClassSection>,
    @InjectRepository(Exam) private readonly examRepo: Repository<Exam>,
    @InjectRepository(Result) private readonly resultRepo: Repository<Result>,
    @InjectRepository(Student) private readonly studentRepo: Repository<Student>,
    @InjectRepository(Enrollment) private readonly enrollmentRepo: Repository<Enrollment>,
    @InjectRepository(AcademicYear) private readonly academicYearRepo: Repository<AcademicYear>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly enrollmentService: EnrollmentService,
    private readonly auditService: AuditService,
    private readonly approvalService: ApprovalService,
  ) {}

  // ────────────────────────
  //  Target suggestion (step 2)
  // ────────────────────────

  async suggestTarget(
    sourceClassId: string,
    targetAcademicYearId: string,
    tenantId: string,
  ): Promise<TargetSuggestion> {
    const sourceClass = await this.classRepo.findOne({
      where: { id: sourceClassId, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!sourceClass) {
      throw new NotFoundException(`Class with ID "${sourceClassId}" not found`);
    }
    return this.resolveTarget(sourceClass, targetAcademicYearId, undefined, tenantId);
  }

  /**
   * D13/D14/D20 — resolves the target-year class (or `null` = graduate) and
   * the D20 retain class. `explicitTargetClassId` overrides the
   * `numeric_grade + 1` lookup when the caller names one directly (create's
   * `target_class_id`).
   */
  private async resolveTarget(
    sourceClass: Class,
    targetAcademicYearId: string,
    explicitTargetClassId: string | undefined,
    tenantId: string,
  ): Promise<TargetSuggestion> {
    let targetClass: Class | null = null;
    let blocking: BlockingReason | undefined;

    if (explicitTargetClassId) {
      targetClass = await this.classRepo.findOne({
        where: {
          id: explicitTargetClassId,
          academic_year_id: targetAcademicYearId,
          tenant_id: tenantId,
          deleted_at: IsNull(),
        },
      });
      if (!targetClass) {
        throw new BadRequestException(
          `Class with ID "${explicitTargetClassId}" not found in academic year "${targetAcademicYearId}"`,
        );
      }
    } else if (sourceClass.numeric_grade === null) {
      blocking = 'PICK_TARGET_CLASS';
    } else {
      targetClass = await this.classRepo.findOne({
        where: {
          numeric_grade: sourceClass.numeric_grade + 1,
          shift_id: sourceClass.shift_id ?? IsNull(),
          version: sourceClass.version ?? IsNull(),
          academic_year_id: targetAcademicYearId,
          tenant_id: tenantId,
          deleted_at: IsNull(),
        },
      });
      // No match, but numeric_grade is set → this run graduates the class (D13).
    }

    const retainClass =
      sourceClass.numeric_grade !== null
        ? await this.findRetainClass(sourceClass, targetAcademicYearId, tenantId, this.classRepo)
        : null;

    let sections: ClassSection[] = [];
    if (targetClass) {
      sections = await this.sectionRepo.find({
        where: { class_id: targetClass.id, tenant_id: tenantId, deleted_at: IsNull() },
        order: { section_name: 'ASC' },
      });
      if (sections.length === 0 && !blocking) {
        blocking = 'TARGET_SECTIONS_MISSING';
      }
    }

    if (!blocking && sourceClass.numeric_grade !== null && !retainClass) {
      blocking = 'RETAIN_CLASS_MISSING';
    }

    return {
      target_class: targetClass ? { id: targetClass.id, name: targetClass.name } : null,
      retain_class: retainClass ? { id: retainClass.id, name: retainClass.name } : null,
      sections: sections.map((s) => ({
        id: s.id,
        section_name: s.section_name,
        capacity: s.capacity,
        group_name: s.group_name,
      })),
      blocking_reason: blocking,
    };
  }

  // ────────────────────────
  //  Cohort computation (steps 3 & 5, shared by create/refresh)
  // ────────────────────────

  /** D20 — single source for the retain-class lookup, shared by resolveTarget() and commit(). */
  private async findRetainClass(
    sourceClass: Class,
    targetAcademicYearId: string,
    tenantId: string,
    classRepo: Repository<Class>,
  ): Promise<Class | null> {
    // M1 — a null numeric_grade has no identity signal to match on: an
    // `IsNull()` lookup would wildcard-match ANY other null-grade class in
    // the target year (e.g. retaining Playgroup into Nursery). Callers
    // already treat a missing retain class as RETAIN_CLASS_MISSING, so
    // force that instead of guessing.
    if (sourceClass.numeric_grade === null) return null;
    return classRepo.findOne({
      where: {
        numeric_grade: sourceClass.numeric_grade,
        shift_id: sourceClass.shift_id ?? IsNull(),
        version: sourceClass.version ?? IsNull(),
        academic_year_id: targetAcademicYearId,
        tenant_id: tenantId,
        deleted_at: IsNull(),
      },
    });
  }

  private async computeCohortStats(
    sourceClassId: string,
    sourceAcademicYearId: string,
    examIds: string[],
    tenantId: string,
  ): Promise<CohortStudentStat[]> {
    const enrollments = await this.enrollmentRepo.find({
      where: {
        class_id: sourceClassId,
        academic_year_id: sourceAcademicYearId,
        enrollment_status: EnrollmentStatus.ACTIVE,
        tenant_id: tenantId,
      },
    });
    if (enrollments.length === 0) return [];

    const studentIds = enrollments.map((e) => e.student_id);
    const results = await this.resultRepo.find({
      where: {
        student_id: In(studentIds),
        exam_id: In(examIds),
        tenant_id: tenantId,
        deleted_at: IsNull(),
      },
    });
    const resultsByStudent = new Map<string, Result[]>();
    for (const result of results) {
      const list = resultsByStudent.get(result.student_id) ?? [];
      list.push(result);
      resultsByStudent.set(result.student_id, list);
    }

    return enrollments.map((enrollment) => {
      const studentResults = resultsByStudent.get(enrollment.student_id) ?? [];
      const examIdsWithResult = new Set(studentResults.map((r) => r.exam_id));
      const passedAll =
        examIds.every((id) => examIdsWithResult.has(id)) && studentResults.every((r) => !r.is_fail);
      const meanGpa =
        studentResults.length > 0
          ? studentResults.reduce((sum, r) => sum + Number(r.gpa), 0) / studentResults.length
          : 0;
      const totalMarksSum = studentResults.reduce((sum, r) => sum + Number(r.total_marks), 0);

      return {
        student_id: enrollment.student_id,
        enrollment_id: enrollment.id,
        section_id: enrollment.section_id,
        group_name: null, // resolved by caller against the current class_section
        passed_all: passedAll,
        mean_gpa: meanGpa,
        total_marks_sum: totalMarksSum,
      };
    });
  }

  private composeOutcome(passedAll: boolean, isGraduationRun: boolean): PromotionOutcome {
    const suggested = suggestOutcome(passedAll);
    if (suggested === PromotionOutcome.PROMOTE && isGraduationRun) {
      return PromotionOutcome.GRADUATE;
    }
    return suggested;
  }

  /** Runs `place()` for every PROMOTE-suggested entry and writes back its placement. */
  private placePromoteEntries(
    entries: PromotionEntry[],
    sections: PlacementSection[],
    algorithm: PlacementAlgorithm,
  ): void {
    const promoteEntries = entries.filter((e) => e.final_outcome === PromotionOutcome.PROMOTE);
    // Preserve merit-rank order (entries are ranked ascending by merit_rank).
    const ranked = [...promoteEntries].sort(
      (a, b) =>
        (a.merit_rank ?? Number.MAX_SAFE_INTEGER) - (b.merit_rank ?? Number.MAX_SAFE_INTEGER),
    );
    const placementStudents: PlacementStudent[] = ranked.map((e) => ({
      student_id: e.student_id,
      group_name: e.group_name,
    }));
    const { assignments, errors } = place(placementStudents, sections, algorithm);
    const rolls = assignRolls(placementStudents, assignments);

    for (const entry of entries) {
      if (entry.final_outcome !== PromotionOutcome.PROMOTE) {
        entry.target_section_id = null;
        entry.new_roll_number = null;
        entry.placement_error = null;
        continue;
      }
      const sectionId = assignments[entry.student_id] ?? null;
      entry.target_section_id = sectionId;
      entry.new_roll_number = sectionId ? (rolls[entry.student_id] ?? null) : null;
      entry.placement_error = errors[entry.student_id] ?? null;
    }
  }

  // ────────────────────────
  //  Create (step 3)
  // ────────────────────────

  async create(
    dto: CreatePromotionRunDto,
    tenantId: string,
    userId: string,
  ): Promise<PromotionRun> {
    const sourceClass = await this.classRepo.findOne({
      where: { id: dto.source_class_id, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!sourceClass) {
      throw new NotFoundException(`Class with ID "${dto.source_class_id}" not found`);
    }

    const suggestion = await this.resolveTarget(
      sourceClass,
      dto.target_academic_year_id,
      dto.target_class_id,
      tenantId,
    );
    if (suggestion.blocking_reason === 'PICK_TARGET_CLASS') {
      throw new UnprocessableEntityException({ details: { code: 'PICK_TARGET_CLASS' } });
    }
    if (suggestion.blocking_reason === 'TARGET_SECTIONS_MISSING') {
      throw new UnprocessableEntityException({ details: { code: 'TARGET_SECTIONS_MISSING' } });
    }
    if (suggestion.blocking_reason === 'RETAIN_CLASS_MISSING') {
      throw new UnprocessableEntityException({ details: { code: 'RETAIN_CLASS_MISSING' } });
    }

    const exams = await this.examRepo.find({
      where: {
        id: In(dto.exam_ids),
        tenant_id: tenantId,
        class_id: dto.source_class_id,
        academic_year_id: sourceClass.academic_year_id,
        status: ExamStatus.PUBLISHED,
        deleted_at: IsNull(),
      },
    });
    if (exams.length !== new Set(dto.exam_ids).size) {
      throw new UnprocessableEntityException(
        'exam_ids must all be PUBLISHED exams of the source class in its academic year',
      );
    }

    const stats = await this.computeCohortStats(
      dto.source_class_id,
      sourceClass.academic_year_id,
      dto.exam_ids,
      tenantId,
    );

    // group_name defaults to the student's current section's group_name.
    const sectionIds = [
      ...new Set(stats.map((s) => s.section_id).filter((id): id is string => !!id)),
    ];
    const sourceSections = sectionIds.length
      ? await this.sectionRepo.find({ where: { id: In(sectionIds) } })
      : [];
    const sectionGroupById = new Map(sourceSections.map((s) => [s.id, s.group_name]));

    const isGraduationRun = suggestion.target_class === null;
    const ranked = meritOrder(
      stats.map((s) => ({
        student_id: s.student_id,
        mean_gpa: s.mean_gpa,
        total_marks_sum: s.total_marks_sum,
      })),
    );
    const rankByStudent = new Map(ranked.map((r) => [r.student_id, r.merit_rank]));

    const occupancyById = await this.getSectionOccupancy(
      suggestion.sections.map((s) => s.id),
      tenantId,
      this.studentRepo,
    );
    const targetSections: PlacementSection[] = suggestion.sections.map((s) => ({
      id: s.id,
      section_name: s.section_name,
      capacity: s.capacity,
      group_name: s.group_name,
      occupied_count: occupancyById.get(s.id) ?? 0,
    }));

    return this.runRepo.manager.transaction(async (manager) => {
      const runRepo = manager.getRepository(PromotionRun);
      const entryRepo = manager.getRepository(PromotionEntry);

      const run = await runRepo.save(
        runRepo.create({
          tenant_id: tenantId,
          source_class_id: dto.source_class_id,
          source_academic_year_id: sourceClass.academic_year_id,
          target_academic_year_id: dto.target_academic_year_id,
          target_class_id: suggestion.target_class?.id ?? null,
          exam_ids: dto.exam_ids,
          algorithm: dto.algorithm,
          status: PromotionRunStatus.DRAFT,
          refreshed_at: new Date(),
          override_count: 0,
          created_by_user_id: userId,
        }),
      );

      const entries = stats.map((s) => {
        const groupName = sectionGroupById.get(s.section_id ?? '') ?? null;
        const finalOutcome = this.composeOutcome(s.passed_all, isGraduationRun);
        return entryRepo.create({
          tenant_id: tenantId,
          run_id: run.id,
          student_id: s.student_id,
          source_enrollment_id: s.enrollment_id,
          source_section_id: s.section_id,
          merit_rank: rankByStudent.get(s.student_id) ?? null,
          mean_gpa: s.mean_gpa.toFixed(2),
          total_marks_sum: s.total_marks_sum.toFixed(2),
          passed_all: s.passed_all,
          suggested_outcome: finalOutcome,
          final_outcome: finalOutcome,
          is_override: false,
          override_note: null,
          overridden_by_user_id: null,
          group_name: groupName,
        });
      });

      this.placePromoteEntries(entries, targetSections, dto.algorithm);
      await entryRepo.save(entries);

      return run;
    });
  }

  // ────────────────────────
  //  Patch entries (step 4)
  // ────────────────────────

  async patchEntries(
    runId: string,
    dtoEntries: PatchPromotionEntryDto[],
    tenantId: string,
    userId: string,
  ): Promise<PromotionRun> {
    return this.runRepo.manager
      .transaction(async (manager) => {
        const runRepo = manager.getRepository(PromotionRun);
        const entryRepo = manager.getRepository(PromotionEntry);

        const run = await runRepo.findOne({
          where: { id: runId, tenant_id: tenantId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!run) throw new NotFoundException(`Promotion run "${runId}" not found`);
        if (run.status !== PromotionRunStatus.DRAFT) {
          throw new ConflictException('Only DRAFT runs can be edited');
        }

        const entries = await entryRepo.find({ where: { run_id: run.id, tenant_id: tenantId } });
        const entryByStudent = new Map(entries.map((e) => [e.student_id, e]));

        for (const patch of dtoEntries) {
          const entry = entryByStudent.get(patch.student_id);
          if (!entry) {
            throw new NotFoundException(
              `No promotion entry for student "${patch.student_id}" on this run`,
            );
          }
          // `final_outcome` unset means "leave this entry's outcome as-is" — a
          // patch that only changes group_name must not silently clear an
          // existing override on the same entry.
          const finalOutcome = patch.final_outcome ?? entry.final_outcome;
          const isOverride = finalOutcome !== entry.suggested_outcome;
          const overrideNote = patch.override_note ?? (isOverride ? entry.override_note : null);
          if (isOverride && (!overrideNote || overrideNote.trim().length === 0)) {
            throw new UnprocessableEntityException(
              `Overriding student "${patch.student_id}" requires a non-empty override_note`,
            );
          }
          entry.final_outcome = finalOutcome;
          entry.is_override = isOverride;
          entry.override_note = isOverride ? (overrideNote ?? null) : null;
          entry.overridden_by_user_id = isOverride ? userId : null;
          if (patch.group_name !== undefined) {
            entry.group_name = patch.group_name;
          }
        }

        const targetSections = await this.loadTargetSections(run, manager, tenantId);
        this.placePromoteEntries(entries, targetSections, run.algorithm);
        await entryRepo.save(entries);
        run.override_count = entries.filter((e) => e.is_override).length;
        await runRepo.save(run);

        return runRepo.findOneOrFail({ where: { id: run.id }, relations: [] });
      })
      .then(async (run) => this.findOne(run.id, tenantId));
  }

  /** M3 — counts students already sitting in each target section (they get
   * renumbered, not evicted, at commit) so placement capacity checks
   * account for them. */
  private async getSectionOccupancy(
    sectionIds: string[],
    tenantId: string,
    studentRepo: Repository<Student>,
  ): Promise<Map<string, number>> {
    if (sectionIds.length === 0) return new Map();
    // Only ACTIVE, non-soft-deleted students actually hold a seat —
    // `class_section_id` is never cleared on soft-delete or on a
    // TRANSFERRED/GRADUATED/INACTIVE status change, so counting every row
    // would over-count and could wrongly reject a placement as OVER_CAPACITY.
    // A grouped COUNT avoids hydrating full Student rows just to tally them.
    const rows: Array<{ class_section_id: string; count: string }> = await studentRepo
      .createQueryBuilder('student')
      .select('student.class_section_id', 'class_section_id')
      .addSelect('COUNT(*)', 'count')
      .where('student.class_section_id IN (:...sectionIds)', { sectionIds })
      .andWhere('student.tenant_id = :tenantId', { tenantId })
      .andWhere('student.enrollment_status = :status', { status: EnrollmentStatus.ACTIVE })
      .andWhere('student.deleted_at IS NULL')
      .groupBy('student.class_section_id')
      .getRawMany();
    return new Map(rows.map((r) => [r.class_section_id, Number(r.count)]));
  }

  private async loadTargetSections(
    run: PromotionRun,
    manager: EntityManager,
    tenantId: string,
  ): Promise<PlacementSection[]> {
    if (!run.target_class_id) return [];
    const sections = await manager.getRepository(ClassSection).find({
      where: { class_id: run.target_class_id, tenant_id: tenantId, deleted_at: IsNull() },
      order: { section_name: 'ASC' },
    });
    const occupancyById = await this.getSectionOccupancy(
      sections.map((s) => s.id),
      tenantId,
      manager.getRepository(Student),
    );
    return sections.map((s) => ({
      id: s.id,
      section_name: s.section_name,
      capacity: s.capacity,
      group_name: s.group_name,
      occupied_count: occupancyById.get(s.id) ?? 0,
    }));
  }

  // ────────────────────────
  //  Refresh (step 5, D24)
  // ────────────────────────

  async refresh(runId: string, tenantId: string): Promise<PromotionRun> {
    return this.runRepo.manager
      .transaction(async (manager) => {
        const runRepo = manager.getRepository(PromotionRun);
        const entryRepo = manager.getRepository(PromotionEntry);

        const run = await runRepo.findOne({
          where: { id: runId, tenant_id: tenantId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!run) throw new NotFoundException(`Promotion run "${runId}" not found`);
        if (run.status !== PromotionRunStatus.DRAFT) {
          throw new ConflictException('Only DRAFT runs can be refreshed');
        }

        const entries = await entryRepo.find({ where: { run_id: run.id, tenant_id: tenantId } });
        const entryByStudent = new Map(entries.map((e) => [e.student_id, e]));

        const stats = await this.computeCohortStats(
          run.source_class_id,
          run.source_academic_year_id,
          run.exam_ids,
          tenantId,
        );
        const isGraduationRun = run.target_class_id === null;
        const ranked = meritOrder(
          stats.map((s) => ({
            student_id: s.student_id,
            mean_gpa: s.mean_gpa,
            total_marks_sum: s.total_marks_sum,
          })),
        );
        const rankByStudent = new Map(ranked.map((r) => [r.student_id, r.merit_rank]));

        for (const stat of stats) {
          const entry = entryByStudent.get(stat.student_id);
          if (!entry) continue; // cohort membership changed since create — out of scope, left as-is
          const suggested = this.composeOutcome(stat.passed_all, isGraduationRun);
          entry.passed_all = stat.passed_all;
          entry.mean_gpa = stat.mean_gpa.toFixed(2);
          entry.total_marks_sum = stat.total_marks_sum.toFixed(2);
          entry.merit_rank = rankByStudent.get(stat.student_id) ?? null;
          entry.suggested_outcome = suggested;
          if (!entry.is_override) {
            entry.final_outcome = suggested;
          }
          // M2 — group_name is never reset here: a PATCH group-only edit
          // doesn't set is_override (only outcome changes do, D6/D11), so
          // resetting it on every non-overridden entry silently discarded
          // manual group edits. group_name is only ever (re)computed at
          // create() time; refresh leaves whatever is currently on the row.
          // overridden rows keep final_outcome, override_note, group_name as-is (D24).
        }

        const targetSections = await this.loadTargetSections(run, manager, tenantId);
        this.placePromoteEntries(entries, targetSections, run.algorithm);
        await entryRepo.save(entries);

        run.refreshed_at = new Date();
        await runRepo.save(run);

        return run.id;
      })
      .then((runId2) => this.findOne(runId2, tenantId));
  }

  // ────────────────────────
  //  Delete (step 6)
  // ────────────────────────

  async remove(runId: string, tenantId: string): Promise<void> {
    const run = await this.runRepo.findOne({ where: { id: runId, tenant_id: tenantId } });
    if (!run) throw new NotFoundException(`Promotion run "${runId}" not found`);
    if (run.status !== PromotionRunStatus.DRAFT) {
      throw new ConflictException('Only DRAFT runs can be deleted');
    }
    // B6 — status is part of the DELETE's own WHERE, not just the earlier
    // read: a commit racing this delete between the check above and here
    // would otherwise still get deleted, destroying its enrollment audit
    // trail. Zero rows affected means the run changed status in that gap.
    const result = await this.runRepo.delete({
      id: runId,
      tenant_id: tenantId,
      status: PromotionRunStatus.DRAFT,
    });
    if (!result.affected) {
      throw new ConflictException('Run status changed before it could be deleted');
    }
  }

  // ────────────────────────
  //  List / find (step 7)
  // ────────────────────────

  async list(tenantId: string, sourceClassId?: string): Promise<PromotionRun[]> {
    return this.runRepo.find({
      where: { tenant_id: tenantId, ...(sourceClassId ? { source_class_id: sourceClassId } : {}) },
      order: { created_at: 'DESC' },
    });
  }

  async findOne(
    runId: string,
    tenantId: string,
  ): Promise<PromotionRun & { entries: PromotionEntryView[] }> {
    const run = await this.runRepo.findOne({ where: { id: runId, tenant_id: tenantId } });
    if (!run) throw new NotFoundException(`Promotion run "${runId}" not found`);

    const entries = await this.entryRepo.find({ where: { run_id: run.id, tenant_id: tenantId } });
    const studentIds = entries.map((e) => e.student_id);
    const students = studentIds.length
      ? await this.studentRepo.find({ where: { id: In(studentIds), tenant_id: tenantId } })
      : [];
    const studentById = new Map(students.map((s) => [s.id, s]));

    const view = entries.map((e) => ({
      ...e,
      student_name: studentById.get(e.student_id)?.full_name ?? null,
      student_roll_number: studentById.get(e.student_id)?.roll_number ?? null,
    }));

    return { ...run, entries: view };
  }

  // ────────────────────────
  //  Commit (step 8, D9/D11/D18/D19/D26)
  // ────────────────────────

  async commit(
    runId: string,
    tenantId: string,
    userId: string,
    tenantRole: string,
    approvalRequest: {
      headers: Record<string, string | string[] | undefined>;
      currentTenant?: { id: string };
      user?: { sub: string };
    },
    context: RequestContext = AUTH_REQUEST_STUB,
  ): Promise<{ id: string }> {
    const outcome = await this.runRepo.manager.transaction(async (manager) => {
      const runRepo = manager.getRepository(PromotionRun);
      const entryRepo = manager.getRepository(PromotionEntry);
      const examRepo = manager.getRepository(Exam);
      const resultRepo = manager.getRepository(Result);
      const sectionRepo = manager.getRepository(ClassSection);
      const studentRepo = manager.getRepository(Student);
      const enrollmentRepo = manager.getRepository(Enrollment);
      const classRepo = manager.getRepository(Class);

      // SELECT ... FOR UPDATE so a concurrent second commit attempt blocks
      // on this row instead of racing the status check below (D11 idempotency).
      const run = await runRepo.findOne({
        where: { id: runId, tenant_id: tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!run) throw new NotFoundException(`Promotion run "${runId}" not found`);
      if (run.status === PromotionRunStatus.COMMITTED) {
        throw new ConflictException({ details: { code: 'ALREADY_COMMITTED' } });
      }

      const entries = await entryRepo.find({ where: { run_id: run.id, tenant_id: tenantId } });
      if (entries.some((e) => e.final_outcome === PromotionOutcome.PROMOTE && e.placement_error)) {
        throw new UnprocessableEntityException(
          'Cannot commit: one or more PROMOTE entries has a placement error',
        );
      }

      const cohortStudentIds = entries.map((e) => e.student_id);
      const results =
        run.exam_ids.length && cohortStudentIds.length
          ? await resultRepo.find({
              where: {
                exam_id: In(run.exam_ids),
                student_id: In(cohortStudentIds),
                tenant_id: tenantId,
                deleted_at: IsNull(),
              },
            })
          : [];
      if (results.some((r) => r.computed_at > run.refreshed_at)) {
        throw new ConflictException({ details: { code: 'STALE_RESULTS' } });
      }

      // `refresh()` only re-derives suggestions and re-places — it never
      // drops an entry whose student left the cohort after `create()` (see
      // its own "cohort membership changed — out of scope" comment). Commit
      // must not silently act on a stale entry: PROMOTE/RETAIN would create
      // a spurious new ACTIVE target-year enrollment for a student who was
      // transferred or made inactive in the meantime, and GRADUATE would
      // overwrite a TRANSFERRED/INACTIVE status with GRADUATED (and audit a
      // wrong old_values: 'ACTIVE'). A distinct code from STALE_RESULTS —
      // refresh() can't fix this by re-running, since it never removes the
      // stale entry; the caller has to delete the run and start over.
      const sourceEnrollmentIds = entries.map((e) => e.source_enrollment_id);
      if (sourceEnrollmentIds.length > 0) {
        const sourceEnrollments = await enrollmentRepo.find({
          where: { id: In(sourceEnrollmentIds), tenant_id: tenantId },
        });
        const allStillActive =
          sourceEnrollments.length === sourceEnrollmentIds.length &&
          sourceEnrollments.every((e) => e.enrollment_status === EnrollmentStatus.ACTIVE);
        if (!allStillActive) {
          throw new ConflictException({ details: { code: 'COHORT_CHANGED' } });
        }
      }

      const overrideCount = entries.filter((e) => e.is_override).length;
      let approvedByUserId: string | null = null;
      if (overrideCount > 0) {
        if (!roleHasPermission(tenantRole, Permission.PROMOTION_OVERRIDE)) {
          throw new ForbiddenException(
            'PROMOTION_OVERRIDE permission required to commit overrides',
          );
        }
        const approval = await this.approvalService.consume(
          approvalRequest,
          ApprovalScope.PROMOTION_OVERRIDE,
        );
        approvedByUserId = approval.approverId;
      }

      // ── PROMOTE: renumber existing occupants of target sections, two-phase (D19) ──
      const promoteEntries = entries.filter((e) => e.final_outcome === PromotionOutcome.PROMOTE);
      const targetSectionIds = [
        ...new Set(
          promoteEntries.map((e) => e.target_section_id).filter((id): id is string => !!id),
        ),
      ];

      if (targetSectionIds.length > 0) {
        // `withDeleted: true` — the unique index on (class_section_id,
        // roll_number) is NOT partial, so a soft-deleted student still
        // holds their roll number as far as Postgres is concerned. Leaving
        // them out here would let an incoming student collide with a roll
        // a soft-deleted row still occupies.
        const occupants = await studentRepo.find({
          where: { class_section_id: In(targetSectionIds), tenant_id: tenantId },
          withDeleted: true,
        });
        const bySection = new Map<string, Student[]>();
        for (const occupant of occupants) {
          const list = bySection.get(occupant.class_section_id) ?? [];
          list.push(occupant);
          bySection.set(occupant.class_section_id, list);
        }

        for (const [sectionId, occupantsInSection] of bySection) {
          occupantsInSection.sort((a, b) => a.roll_number - b.roll_number);
          const incomingCount = promoteEntries.filter(
            (e) => e.target_section_id === sectionId,
          ).length;

          // Phase 1: push every existing occupant out of the way so no
          // intermediate roll_number can collide with a final value below.
          for (const occupant of occupantsInSection) {
            await studentRepo.update(
              { id: occupant.id, tenant_id: tenantId },
              { roll_number: occupant.roll_number + 100000 },
            );
          }
          // Phase 2: renumber to their final n+1... values.
          for (let i = 0; i < occupantsInSection.length; i++) {
            const occupant = occupantsInSection[i];
            const finalRoll = incomingCount + i + 1;
            await studentRepo.update(
              { id: occupant.id, tenant_id: tenantId },
              { roll_number: finalRoll },
            );
            await this.auditService.record(
              {
                action: AuditAction.UPDATE,
                entity_type: 'Student',
                entity_id: occupant.id,
                tenant_id: tenantId,
                performed_by_user_id: userId,
                ip_address: context.ip,
                user_agent: context.userAgent,
                old_values: { roll_number: occupant.roll_number },
                new_values: { roll_number: finalRoll },
              },
              manager,
            );
          }
        }
      }

      for (const entry of promoteEntries) {
        if (!entry.target_section_id || !run.target_class_id) continue;
        const enrollment = await this.enrollmentService.createInTransaction(
          manager,
          {
            student_id: entry.student_id,
            class_id: run.target_class_id,
            section_id: entry.target_section_id,
            academic_year_id: run.target_academic_year_id,
          },
          tenantId,
          userId,
          context,
          { rollNumber: entry.new_roll_number ?? undefined },
        );
        entry.target_class_id = run.target_class_id;
        entry.target_enrollment_id = enrollment.id;
      }

      // ── RETAIN: same numeric_grade/shift/version class in the target year, roll appended (D20) ──
      const retainEntries = entries.filter((e) => e.final_outcome === PromotionOutcome.RETAIN);
      if (retainEntries.length > 0) {
        const sourceClass = await classRepo.findOne({
          where: { id: run.source_class_id, tenant_id: tenantId },
        });
        if (!sourceClass) {
          throw new NotFoundException(`Class with ID "${run.source_class_id}" not found`);
        }
        const retainClass = await this.findRetainClass(
          sourceClass,
          run.target_academic_year_id,
          tenantId,
          classRepo,
        );
        if (!retainClass) {
          throw new UnprocessableEntityException({ details: { code: 'RETAIN_CLASS_MISSING' } });
        }
        const retainSections = await sectionRepo.find({
          where: { class_id: retainClass.id, tenant_id: tenantId, deleted_at: IsNull() },
          order: { section_name: 'ASC' },
        });
        if (retainSections.length === 0) {
          throw new UnprocessableEntityException({ details: { code: 'TARGET_SECTIONS_MISSING' } });
        }

        for (const entry of retainEntries) {
          const sourceSection = entry.source_section_id
            ? await sectionRepo.findOne({ where: { id: entry.source_section_id } })
            : null;
          const matchSection =
            retainSections.find((s) => s.section_name === sourceSection?.section_name) ??
            retainSections[0];

          const enrollment = await this.enrollmentService.createInTransaction(
            manager,
            {
              student_id: entry.student_id,
              class_id: retainClass.id,
              section_id: matchSection.id,
              academic_year_id: run.target_academic_year_id,
            },
            tenantId,
            userId,
            context,
          );
          entry.target_class_id = retainClass.id;
          entry.target_section_id = matchSection.id;
          entry.target_enrollment_id = enrollment.id;
        }
      }

      // ── GRADUATE: close out the source enrollment and student status (D18) ──
      const graduateEntries = entries.filter((e) => e.final_outcome === PromotionOutcome.GRADUATE);
      for (const entry of graduateEntries) {
        await studentRepo.update(
          { id: entry.student_id, tenant_id: tenantId },
          { enrollment_status: EnrollmentStatus.GRADUATED },
        );
        await this.auditService.record(
          {
            action: AuditAction.UPDATE,
            entity_type: 'Student',
            entity_id: entry.student_id,
            tenant_id: tenantId,
            performed_by_user_id: userId,
            ip_address: context.ip,
            user_agent: context.userAgent,
            old_values: { enrollment_status: 'ACTIVE' },
            new_values: { enrollment_status: EnrollmentStatus.GRADUATED },
          },
          manager,
        );
        await enrollmentRepo.update(
          { id: entry.source_enrollment_id, tenant_id: tenantId },
          { enrollment_status: EnrollmentStatus.GRADUATED },
        );
        await this.auditService.record(
          {
            action: AuditAction.UPDATE,
            entity_type: 'Enrollment',
            entity_id: entry.source_enrollment_id,
            tenant_id: tenantId,
            performed_by_user_id: userId,
            ip_address: context.ip,
            user_agent: context.userAgent,
            old_values: { enrollment_status: 'ACTIVE' },
            new_values: { enrollment_status: EnrollmentStatus.GRADUATED },
          },
          manager,
        );
      }

      await entryRepo.save(entries);

      run.status = PromotionRunStatus.COMMITTED;
      run.committed_at = new Date();
      run.committed_by_user_id = userId;
      run.approved_by_user_id = approvedByUserId;
      run.override_count = overrideCount;
      await runRepo.save(run);

      // D26 asks for one run-level COMMIT audit entry, but `shared/`'s
      // `AUDIT_ENTITY_TYPES` catalog (shared/src/audit/entity-types.ts)
      // has no 'PromotionRun' literal, and this ticket's territory
      // excludes shared/ (a boundary shared across parallel epic lanes).
      // Every actual data write is now audited: per-enrollment rows (via
      // `createInTransaction`), per-renumbered-student rows, and the
      // GRADUATE Student/Enrollment rows above. Only the run-level summary
      // row is missing. Flagged for a follow-up that adds 'PromotionRun'
      // to the shared catalog.

      return { id: run.id };
    });

    return outcome;
  }

  // ────────────────────────
  //  Student override history (step 9, D12)
  // ────────────────────────

  async findStudentOverrides(studentId: string, tenantId: string) {
    const student = await this.studentRepo.findOne({
      where: { id: studentId, tenant_id: tenantId },
    });
    if (!student) {
      throw new NotFoundException(`Student with ID "${studentId}" not found`);
    }

    const entries = await this.entryRepo.find({
      where: { student_id: studentId, tenant_id: tenantId, is_override: true },
    });
    if (entries.length === 0) return [];

    const runIds = entries.map((e) => e.run_id);
    const runs = await this.runRepo.find({
      where: { id: In(runIds), tenant_id: tenantId, status: PromotionRunStatus.COMMITTED },
    });
    const runById = new Map(runs.map((r) => [r.id, r]));

    const yearIds = [...new Set(runs.map((r) => r.target_academic_year_id))];
    const years = yearIds.length
      ? await this.academicYearRepo.find({ where: { id: In(yearIds) } })
      : [];
    const yearNameById = new Map(years.map((y) => [y.id, y.name]));

    const overriddenUserIds = [
      ...new Set(entries.map((e) => e.overridden_by_user_id).filter((id): id is string => !!id)),
    ];
    const users = overriddenUserIds.length
      ? await this.userRepo.find({ where: { id: In(overriddenUserIds) } })
      : [];
    const userNameById = new Map(users.map((u) => [u.id, u.full_name]));

    return entries
      .filter((e) => runById.has(e.run_id))
      .map((e) => {
        const run = runById.get(e.run_id)!;
        return {
          run_id: run.id,
          target_academic_year_name: yearNameById.get(run.target_academic_year_id) ?? null,
          final_outcome: e.final_outcome,
          override_note: e.override_note,
          overridden_by_name: e.overridden_by_user_id
            ? (userNameById.get(e.overridden_by_user_id) ?? null)
            : null,
          committed_at: run.committed_at,
        };
      });
  }
}

export interface PromotionEntryView extends PromotionEntry {
  student_name: string | null;
  student_roll_number: number | null;
}
