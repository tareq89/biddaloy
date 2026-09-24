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
  students: Array<{ id: string; roll_number: number; full_name: string }>;
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
   * combinations that haven't reached SUBMITTED yet. A section-subject
   * with no `MarkGrid` row at all reads as DRAFT — the row is only
   * created on first save/submit (D12's entity docstring). */
  async progress(
    examId: string,
    tenantId: string,
    stateFilter?: MarkGridState,
  ): Promise<{
    counts: Record<MarkGridState, number>;
    outstanding: Array<{
      section_id: string;
      section_name: string;
      subject_id: string;
      state: MarkGridState;
    }>;
  }> {
    const exam = await this.findExam(examId, tenantId);

    const [sections, components, grids] = await Promise.all([
      this.sectionRepo.find({
        where: { class_id: exam.class_id, tenant_id: tenantId, deleted_at: IsNull() },
        order: { section_name: 'ASC' },
      }),
      this.componentRepo.find({
        where: { exam_id: examId, tenant_id: tenantId, deleted_at: IsNull() },
      }),
      this.gridRepo.find({ where: { exam_id: examId, tenant_id: tenantId } }),
    ]);

    const subjectIds = [...new Set(components.map((c) => c.subject_id))];
    const gridByKey = new Map(grids.map((g) => [`${g.section_id}:${g.subject_id}`, g]));

    const counts: Record<MarkGridState, number> = {
      [MarkGridState.DRAFT]: 0,
      [MarkGridState.SUBMITTED]: 0,
    };
    const outstanding: Array<{
      section_id: string;
      section_name: string;
      subject_id: string;
      state: MarkGridState;
    }> = [];

    for (const section of sections) {
      for (const subjectId of subjectIds) {
        const grid = gridByKey.get(`${section.id}:${subjectId}`);
        const state = grid?.state ?? MarkGridState.DRAFT;
        counts[state] += 1;
        if (stateFilter && state !== stateFilter) continue;
        if (state !== MarkGridState.SUBMITTED) {
          outstanding.push({
            section_id: section.id,
            section_name: section.section_name,
            subject_id: subjectId,
            state,
          });
        }
      }
    }

    return { counts, outstanding };
  }
}
