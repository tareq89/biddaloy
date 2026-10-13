import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository, IsNull, In } from 'typeorm';
import {
  AuditAction,
  EnrollmentStatus,
  ExamComponentSource,
  ExamStatus,
  MarkGridState,
  MarkStatus,
  UserRole,
} from '@biddaloy/shared';
import { Exam } from './entities/exam.entity';
import { ExamComponent } from './entities/exam-component.entity';
import { Mark } from './entities/mark.entity';
import { MarkGrid } from './entities/mark-grid.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Student } from '../students/entities/student.entity';
import { Enrollment } from '../students/entities/enrollment.entity';
import { GridStateActionDto } from './dto/marks.dto';
import { AttendanceComponentService } from './attendance-component.service';
import { MarksAuthorizationService } from './marks-authorization.util';
import { AuditService } from '../audit/audit.service';
import { RequestContext } from '../../common/request-context.util';
import { effectiveSittingDate, joinedAfterExam, subjectSitters } from './exam-cohort';

/**
 * [pr-fix #945] The single serialization point for one grid's marks and
 * state (D12). Creates the grid row as DRAFT if it doesn't exist yet
 * (ON CONFLICT DO NOTHING — a missing row already reads as DRAFT
 * everywhere, so this changes nothing visible), then re-reads it under a
 * row lock. Every mark write, submit and reopen for this
 * exam-section-subject goes through here inside its own transaction, so:
 * - an autosave can't write marks after a concurrent submit commits
 *   SUBMITTED (the old check ran before the transaction, unlocked);
 * - two concurrent first submits can't both insert (unique-index 500);
 * - two concurrent first-writes of the same mark cell serialize too — a
 *   cell's student is pinned to this section and its component to this
 *   subject, so the same cell always maps to this same grid row.
 */
export async function lockGrid(
  manager: EntityManager,
  key: { tenantId: string; examId: string; sectionId: string; subjectId: string },
): Promise<MarkGrid> {
  const where = {
    exam_id: key.examId,
    section_id: key.sectionId,
    subject_id: key.subjectId,
    tenant_id: key.tenantId,
  };
  const repo = manager.getRepository(MarkGrid);
  await repo
    .createQueryBuilder()
    .insert()
    .into(MarkGrid)
    .values({ ...where, state: MarkGridState.DRAFT })
    .orIgnore()
    .execute();
  return repo.findOneOrFail({ where, lock: { mode: 'pessimistic_write' } });
}

export interface GridResponse {
  exam_id: string;
  section_id: string;
  subject_id: string;
  state: MarkGridState;
  submitted_by: string | null;
  submitted_at: Date | null;
  students: Array<{
    id: string;
    roll_number: number;
    full_name: string;
    /** Enrolled after the last sitting with no marks: not in the exam's cohort, never blocks submit. */
    joined_after_exam: boolean;
    /** Another stream, or an optional / choice subject not picked: no marks owed, never blocks submit. */
    not_taking: boolean;
  }>;
  components: Array<{
    id: string;
    name: string;
    kind: string;
    source: string;
    full_marks: string;
    pass_marks: string | null;
    sequence: number;
  }>;
  cells: Array<{ student_id: string; component_id: string; value: string | null; status: string }>;
  derived: Record<string, { reason: string | null; values: Record<string, string | null> }>;
}

/**
 * [19.4.1] D12 — the grid's DRAFT/SUBMITTED state machine, and the
 * composed GET that fills the whole entry grid in one request.
 * `MarksService` refuses writes to a SUBMITTED grid via `lockGrid`.
 */
@Injectable()
export class MarkGridService {
  constructor(
    @InjectRepository(Exam)
    private readonly examRepo: Repository<Exam>,
    @InjectRepository(ExamComponent)
    private readonly componentRepo: Repository<ExamComponent>,
    @InjectRepository(Mark)
    private readonly markRepo: Repository<Mark>,
    @InjectRepository(MarkGrid)
    private readonly gridRepo: Repository<MarkGrid>,
    @InjectRepository(ClassSection)
    private readonly sectionRepo: Repository<ClassSection>,
    @InjectRepository(Student)
    private readonly studentRepo: Repository<Student>,
    @InjectRepository(Enrollment)
    private readonly enrollmentRepo: Repository<Enrollment>,
    private readonly attendanceComponentService: AttendanceComponentService,
    private readonly authz: MarksAuthorizationService,
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

  private async findSection(sectionId: string, tenantId: string): Promise<ClassSection> {
    const section = await this.sectionRepo.findOne({
      where: { id: sectionId, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!section) {
      throw new NotFoundException(`Section with ID "${sectionId}" not found`);
    }
    return section;
  }

  /** Students of `enrollments` who joined after the exam's last sitting and
   * have no Mark row for this exam (any subject). They did not sit it. */
  private async lateJoiners(
    manager: EntityManager,
    exam: Exam,
    tenantId: string,
    enrollments: Enrollment[],
  ): Promise<Set<string>> {
    if (enrollments.length === 0) return new Set();
    const lastSitting = await effectiveSittingDate(manager, exam, tenantId);
    const late = enrollments.filter((e) => joinedAfterExam(e.enrolled_at, lastSitting));
    if (late.length === 0) return new Set();
    const withMark = await manager.getRepository(Mark).find({
      where: {
        exam_id: exam.id,
        tenant_id: tenantId,
        student_id: In(late.map((e) => e.student_id)),
      },
      select: { student_id: true },
    });
    const has = new Set(withMark.map((m) => m.student_id));
    return new Set(late.filter((e) => !has.has(e.student_id)).map((e) => e.student_id));
  }

  /** ACAD-04 / X-06: per `section:subject` key, every rostered student's
   * MANUAL cell that is neither a mark nor a deliberate A / E. DERIVED
   * components are never blank. A student who does not sit the subject
   * (another stream, or an optional / choice subject they did not pick) and
   * a late joiner owe nothing. One set of queries for all `pairs`. */
  private async blankCells(
    manager: EntityManager,
    exam: Exam,
    tenantId: string,
    pairs: { sectionId: string; subjectId: string }[],
  ): Promise<Map<string, { student_id: string; component_id: string }[]>> {
    const out = new Map<string, { student_id: string; component_id: string }[]>();
    if (pairs.length === 0) return out;
    const sectionIds = [...new Set(pairs.map((p) => p.sectionId))];
    const subjectIds = [...new Set(pairs.map((p) => p.subjectId))];
    const enrollments = await manager.getRepository(Enrollment).find({
      where: {
        tenant_id: tenantId,
        academic_year_id: exam.academic_year_id,
        class_id: exam.class_id,
        section_id: In(sectionIds),
        enrollment_status: EnrollmentStatus.ACTIVE,
      },
      relations: { section: true },
    });
    if (enrollments.length === 0) return out;
    const studentIds = enrollments.map((e) => e.student_id);
    const [students, components, marks, late, sitters] = await Promise.all([
      manager.getRepository(Student).find({
        where: { id: In(studentIds), tenant_id: tenantId, deleted_at: IsNull() },
        select: { id: true },
      }),
      manager.getRepository(ExamComponent).find({
        where: {
          exam_id: exam.id,
          subject_id: In(subjectIds),
          tenant_id: tenantId,
          deleted_at: IsNull(),
          source: ExamComponentSource.MANUAL,
        },
      }),
      manager.getRepository(Mark).find({
        where: {
          exam_id: exam.id,
          subject_id: In(subjectIds),
          student_id: In(studentIds),
          tenant_id: tenantId,
        },
      }),
      this.lateJoiners(manager, exam, tenantId, enrollments),
      subjectSitters(manager, exam, tenantId, enrollments, subjectIds),
    ]);
    const live = new Set(students.map((s) => s.id));
    const filled = new Set(
      marks
        .filter((m) => m.status !== MarkStatus.PRESENT || m.value !== null)
        .map((m) => `${m.student_id}:${m.component_id}`),
    );
    for (const { sectionId, subjectId } of pairs) {
      const takers = sitters.get(subjectId);
      const subjectComponents = components.filter((c) => c.subject_id === subjectId);
      const blank: { student_id: string; component_id: string }[] = [];
      for (const e of enrollments) {
        if (e.section_id !== sectionId || !live.has(e.student_id) || late.has(e.student_id)) {
          continue;
        }
        if (takers && !takers.has(e.student_id)) continue;
        for (const c of subjectComponents) {
          if (!filled.has(`${e.student_id}:${c.id}`)) {
            blank.push({ student_id: e.student_id, component_id: c.id });
          }
        }
      }
      out.set(`${sectionId}:${subjectId}`, blank);
    }
    return out;
  }

  async getGrid(
    examId: string,
    sectionId: string,
    subjectId: string,
    tenantId: string,
    role: string,
    userId: string,
  ): Promise<GridResponse> {
    const exam = await this.findExam(examId, tenantId);
    await this.findSection(sectionId, tenantId);
    await this.authz.assertCanRead({ role, userId, tenantId, sectionId, subjectId });

    // D17: the grid's roster is whoever holds an ACTIVE enrollment for this
    // exam's own (academic_year_id, class_id) with section_id = sectionId —
    // not `Student.class_section_id`, which is the student's CURRENT
    // placement and can point elsewhere for an old exam after promotion.
    const enrollments = await this.enrollmentRepo.find({
      where: {
        tenant_id: tenantId,
        academic_year_id: exam.academic_year_id,
        class_id: exam.class_id,
        section_id: sectionId,
        enrollment_status: EnrollmentStatus.ACTIVE,
      },
      relations: { section: true },
    });
    const [studentsUnsorted, components, marks, grid] = await Promise.all([
      enrollments.length === 0
        ? Promise.resolve([])
        : this.studentRepo.find({
            where: {
              id: In(enrollments.map((e) => e.student_id)),
              tenant_id: tenantId,
              deleted_at: IsNull(),
            },
          }),
      this.componentRepo.find({
        where: {
          exam_id: examId,
          subject_id: subjectId,
          tenant_id: tenantId,
          deleted_at: IsNull(),
        },
        order: { sequence: 'ASC' },
      }),
      this.markRepo.find({
        where: { exam_id: examId, subject_id: subjectId, tenant_id: tenantId },
      }),
      this.gridRepo.findOne({
        where: {
          exam_id: examId,
          section_id: sectionId,
          subject_id: subjectId,
          tenant_id: tenantId,
        },
      }),
    ]);
    const students = [...studentsUnsorted].sort((a, b) => a.roll_number - b.roll_number);
    const [late, sitters] = await Promise.all([
      this.lateJoiners(this.gridRepo.manager, exam, tenantId, enrollments),
      subjectSitters(this.gridRepo.manager, exam, tenantId, enrollments, [subjectId]),
    ]);
    const takers = sitters.get(subjectId);

    // Mark has no section column, so the query above pulls every mark
    // ever entered for this exam+subject across ALL sections — filter to
    // this section's own students or a cross-section leak reaches the
    // response (a data leak, not just noisy cells the UI can't place).
    const sectionStudentIds = new Set(students.map((s) => s.id));
    const sectionMarks = marks.filter((m) => sectionStudentIds.has(m.student_id));

    const derivedComponents = components.filter((c) => c.source === ExamComponentSource.DERIVED);
    const derived: GridResponse['derived'] = {};
    for (const component of derivedComponents) {
      const result = await this.attendanceComponentService.computeForSection({
        examId,
        sectionId,
        fullMarks: component.full_marks,
        tenantId,
      });
      derived[component.id] = {
        reason: result.reason,
        values: Object.fromEntries(result.valuesByStudent),
      };
    }

    return {
      exam_id: examId,
      section_id: sectionId,
      subject_id: subjectId,
      state: grid?.state ?? MarkGridState.DRAFT,
      submitted_by: grid?.submitted_by ?? null,
      submitted_at: grid?.submitted_at ?? null,
      students: students.map((s) => ({
        id: s.id,
        roll_number: s.roll_number,
        full_name: s.full_name,
        joined_after_exam: late.has(s.id),
        not_taking: takers !== undefined && !takers.has(s.id),
      })),
      components: components.map((c) => ({
        id: c.id,
        name: c.name,
        kind: c.kind,
        source: c.source,
        full_marks: c.full_marks,
        pass_marks: c.pass_marks,
        sequence: c.sequence,
      })),
      cells: sectionMarks.map((m) => ({
        student_id: m.student_id,
        component_id: m.component_id,
        value: m.value,
        status: m.status,
      })),
      derived,
    };
  }

  async submit(
    examId: string,
    dto: GridStateActionDto,
    tenantId: string,
    role: string,
    userId: string,
    context: RequestContext = { ip: null, userAgent: null },
  ): Promise<MarkGrid> {
    const exam = await this.findExam(examId, tenantId);
    if (exam.status === ExamStatus.PUBLISHED) {
      throw new ConflictException(
        'This exam is already published — its grids can no longer be submitted.',
      );
    }

    await this.authz.assertCanWrite({
      role,
      userId,
      tenantId,
      sectionId: dto.section_id,
      subjectId: dto.subject_id,
    });

    return this.gridRepo.manager.transaction(async (manager) => {
      const existing = await lockGrid(manager, {
        tenantId,
        examId,
        sectionId: dto.section_id,
        subjectId: dto.subject_id,
      });
      if (existing.state === MarkGridState.SUBMITTED) {
        throw new ConflictException(
          `This grid was already submitted (by user "${existing.submitted_by}" at ${existing.submitted_at?.toISOString()}).`,
        );
      }

      const key = { sectionId: dto.section_id, subjectId: dto.subject_id };
      const blank =
        (await this.blankCells(manager, exam, tenantId, [key])).get(
          `${key.sectionId}:${key.subjectId}`,
        ) ?? [];
      if (blank.length > 0) {
        throw new ConflictException({
          message: `${blank.length} blank cell(s). Enter a mark, A (absent) or E (exempt) for each before submitting.`,
          details: {
            code: 'GRID_INCOMPLETE',
            blank_count: blank.length,
            blank: blank.slice(0, 50),
          },
        });
      }

      const submittedAt = new Date();
      await manager
        .getRepository(MarkGrid)
        .update(
          { id: existing.id },
          { state: MarkGridState.SUBMITTED, submitted_by: userId, submitted_at: submittedAt },
        );
      const saved: MarkGrid = {
        ...existing,
        state: MarkGridState.SUBMITTED,
        submitted_by: userId,
        submitted_at: submittedAt,
      };

      await this.auditService.record(
        {
          action: AuditAction.UPDATE,
          entity_type: 'MarkGrid',
          entity_id: saved.id,
          tenant_id: tenantId,
          performed_by_user_id: userId,
          ip_address: context.ip,
          user_agent: context.userAgent,
          old_values: { state: existing.state },
          new_values: { state: MarkGridState.SUBMITTED },
        },
        manager,
      );

      return saved;
    });
  }

  async reopen(
    examId: string,
    dto: GridStateActionDto,
    tenantId: string,
    role: string,
    userId: string,
    context: RequestContext = { ip: null, userAgent: null },
  ): Promise<MarkGrid> {
    if (role !== UserRole.ADMIN) {
      throw new ForbiddenException('Only an admin may reopen a submitted grid.');
    }
    const exam = await this.findExam(examId, tenantId);
    if (exam.status === ExamStatus.PUBLISHED) {
      throw new ConflictException(
        'This exam is already published — reopen its result instead of a grid.',
      );
    }

    return this.gridRepo.manager.transaction(async (manager) => {
      // A DRAFT row this creates for a never-touched grid rolls back with
      // the 404 below — nothing is left behind.
      const existing = await lockGrid(manager, {
        tenantId,
        examId,
        sectionId: dto.section_id,
        subjectId: dto.subject_id,
      });
      if (existing.state !== MarkGridState.SUBMITTED) {
        throw new NotFoundException('No submitted grid found for this exam-section-subject.');
      }
      const repo = manager.getRepository(MarkGrid);
      await repo.update(
        { id: existing.id },
        { state: MarkGridState.DRAFT, submitted_by: null, submitted_at: null },
      );

      await this.auditService.record(
        {
          action: AuditAction.UPDATE,
          entity_type: 'MarkGrid',
          entity_id: existing.id,
          tenant_id: tenantId,
          performed_by_user_id: userId,
          ip_address: context.ip,
          user_agent: context.userAgent,
          old_values: { state: MarkGridState.SUBMITTED, submitted_by: existing.submitted_by },
          new_values: { state: MarkGridState.DRAFT },
        },
        manager,
      );

      return { ...existing, state: MarkGridState.DRAFT, submitted_by: null, submitted_at: null };
    });
  }

  /** Per-exam progress: counts of grids by state, plus the section-subject
   * combinations that haven't reached SUBMITTED yet, or were submitted with
   * blank cells (outstanding = not submitted, or submitted with blank cells). A section-subject
   * with no `MarkGrid` row at all reads as DRAFT — the row is only
   * created on first save/submit (D12's entity docstring). */
  async progress(
    examId: string,
    tenantId: string,
    stateFilter: MarkGridState | undefined,
    /** `null` only for internal, unscoped use (results processing). */
    caller: { role: string; userId: string } | null,
  ): Promise<{
    counts: Record<MarkGridState, number>;
    outstanding: Array<{
      section_id: string;
      section_name: string;
      subject_id: string;
      subject_name: string | null;
      subject_name_bn: string | null;
      state: MarkGridState;
    }>;
  }> {
    const exam = await this.findExam(examId, tenantId);

    const [classSections, components, grids] = await Promise.all([
      this.sectionRepo.find({
        where: { class_id: exam.class_id, tenant_id: tenantId, deleted_at: IsNull() },
        order: { section_name: 'ASC' },
      }),
      this.componentRepo.find({
        where: { exam_id: examId, tenant_id: tenantId, deleted_at: IsNull() },
        relations: { subject: true },
        // a soft-deleted subject still names its outstanding grid; the
        // component's own deleted_at stays filtered above
        withDeleted: true,
      }),
      this.gridRepo.find({ where: { exam_id: examId, tenant_id: tenantId } }),
    ]);

    // D33/D44: a teacher sees (and counts) only the (section, subject) grids they may write.
    const writable = caller
      ? await this.authz.writableSubjects(
          { ...caller, tenantId },
          classSections.map((s) => s.id),
        )
      : null;
    const canOpen = (sectionId: string, subjectId: string) =>
      !writable || !!writable.get(sectionId)?.has(subjectId);

    const subjectIds = [...new Set(components.map((c) => c.subject_id))];
    // Names only from this tenant's own subjects (multi-tenancy rule) — a
    // foreign-tenant subject is filtered here rather than in the query's
    // `where`, which would drop the component and silently shrink the counts.
    const subjectById = new Map(
      components
        .filter((c) => c.subject?.tenant_id === tenantId)
        .map((c) => [c.subject_id, c.subject]),
    );
    const gridByKey = new Map(grids.map((g) => [`${g.section_id}:${g.subject_id}`, g]));

    const counts: Record<MarkGridState, number> = {
      [MarkGridState.DRAFT]: 0,
      [MarkGridState.SUBMITTED]: 0,
    };
    const outstanding: Array<{
      section_id: string;
      section_name: string;
      subject_id: string;
      subject_name: string | null;
      subject_name_bn: string | null;
      state: MarkGridState;
    }> = [];

    // One batch for every SUBMITTED grid, not a query set per grid.
    const sectionIdSet = new Set(classSections.map((s) => s.id));
    const blanks = await this.blankCells(
      this.gridRepo.manager,
      exam,
      tenantId,
      grids
        .filter(
          (g) =>
            g.state === MarkGridState.SUBMITTED &&
            sectionIdSet.has(g.section_id) &&
            subjectIds.includes(g.subject_id) &&
            canOpen(g.section_id, g.subject_id),
        )
        .map((g) => ({ sectionId: g.section_id, subjectId: g.subject_id })),
    );

    for (const section of classSections) {
      for (const subjectId of subjectIds) {
        if (!canOpen(section.id, subjectId)) continue;
        const grid = gridByKey.get(`${section.id}:${subjectId}`);
        const state = grid?.state ?? MarkGridState.DRAFT;
        counts[state] += 1;
        if (stateFilter && state !== stateFilter) continue;
        const hasBlanks =
          state === MarkGridState.SUBMITTED &&
          (blanks.get(`${section.id}:${subjectId}`)?.length ?? 0) > 0;
        if (state !== MarkGridState.SUBMITTED || hasBlanks) {
          outstanding.push({
            section_id: section.id,
            section_name: section.section_name,
            subject_id: subjectId,
            subject_name: subjectById.get(subjectId)?.name_en ?? null,
            subject_name_bn: subjectById.get(subjectId)?.name_bn ?? null,
            state,
          });
        }
      }
    }

    return { counts, outstanding };
  }
}
