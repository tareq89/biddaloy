import { AcrAssessment } from '../acr/entities/acr-assessment.entity';
import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, EntityManager } from 'typeorm';
import { AcademicYear } from './entities/academic-year.entity';
import { Class } from './entities/class.entity';
import { Enrollment } from '../students/entities/enrollment.entity';
import { FeeStructure } from '../fees/entities/fee-structure.entity';
import { StudentFee } from '../fees/entities/student-fee.entity';
import { Exam } from '../exams/entities/exam.entity';
import { AcademicTerm } from '../calendar/entities/academic-term.entity';
import { CalendarEvent } from '../calendar/entities/calendar-event.entity';
import { assertNoLiveDependents } from '../../common/utils/live-dependents';
import { dropClassSubjects } from './drop-class-subjects';
import { CreateAcademicYearDto } from './dto/create-academic-year.dto';
import { UpdateAcademicYearDto } from './dto/update-academic-year.dto';
import { QueryAcademicYearDto } from './dto/query-academic-year.dto';
import {
  EnrollmentStatus,
  AuditAction,
  ExamStatus,
  PromotionRunStatus,
  YEAR_CLOSE_BLOCK_DRAFT_PROMOTION,
  type YearClosePreview,
  type YearReadiness,
} from '@biddaloy/shared';
import { YEAR_SCOPED_WRITES } from '../../common/utils/year-open.guard';
import { OPEN_FEE_STATUSES } from '../fees/fees.constants';
import { toPaisa } from '../../common/constants/money';
import type { ApprovalContext } from '../auth/guards/approval.guard';
import { AuditService } from '../audit/audit.service';
import { RequestContext } from '../../common/request-context.util';
import { yearClosed } from '../../common/filters/known-errors';

/** Entity name (as in `YEAR_SCOPED_WRITES`) -> table, for the close preview's freeze counts. */
const YEAR_SCOPED_TABLES: Record<string, string> = {
  Class: 'classes',
  ClassSubject: 'class_subjects',
  AcademicTerm: 'academic_terms',
  CalendarEvent: 'calendar_events',
  Exam: 'exams',
  FeeGeneration: 'fee_generations',
  FeeStructure: 'fee_structures',
  FineRule: 'fine_rules',
  RecurringSchedule: 'recurring_schedules',
  StudentFee: 'student_fees',
  GradingScale: 'grading_scales',
  PromotionRun: 'promotion_runs',
  Routine: 'routines',
  Enrollment: 'enrollments',
  StudentLifecycleEvent: 'student_lifecycle_events',
  StudentSubjectChoice: 'student_subject_choices',
  StudyPlan: 'study_plans',
  AcrAssessment: 'acr_assessments',
  Application: 'applications',
  Program: 'programs',
  FinalResult: 'final_results',
};

export interface AcademicYearStats {
  classes_count: number;
  students_count: number;
  fee_structures_count: number;
}

@Injectable()
export class AcademicYearService {
  constructor(
    @InjectRepository(AcademicYear)
    private readonly repo: Repository<AcademicYear>,
    @InjectRepository(Class)
    private readonly classRepo: Repository<Class>,
    @InjectRepository(Enrollment)
    private readonly enrollmentRepo: Repository<Enrollment>,
    @InjectRepository(FeeStructure)
    private readonly feeStructureRepo: Repository<FeeStructure>,
    private readonly auditService: AuditService,
  ) {}

  async create(
    dto: CreateAcademicYearDto,
    tenantId: string,
    userId: string | null = null,
    context: RequestContext = { ip: null, userAgent: null },
  ): Promise<AcademicYear> {
    return this.repo.manager.transaction(async (manager) => {
      const repo = manager.getRepository(AcademicYear);

      // If setting as current, unset all other current years for this
      // tenant — read them first (locked) so each displaced year gets its
      // own `true -> false` audit entry, same as setCurrent below.
      let displaced: AcademicYear[] = [];
      if (dto.is_current) {
        displaced = await repo.find({
          where: { tenant_id: tenantId, is_current: true, deleted_at: IsNull() },
          lock: { mode: 'pessimistic_write' },
        });
        await repo.update(
          { tenant_id: tenantId, is_current: true, deleted_at: IsNull() },
          { is_current: false },
        );
      }

      const academicYear = repo.create({
        ...dto,
        tenant_id: tenantId,
        start_date: new Date(dto.start_date),
        end_date: new Date(dto.end_date),
      });

      const saved = await repo.save(academicYear);

      for (const year of displaced) {
        await this.auditService.record(
          {
            action: AuditAction.UPDATE,
            entity_type: 'AcademicYear',
            entity_id: year.id,
            tenant_id: tenantId,
            performed_by_user_id: userId,
            ip_address: context.ip,
            user_agent: context.userAgent,
            old_values: { is_current: true },
            new_values: { is_current: false },
          },
          manager,
        );
      }

      await this.auditService.record(
        {
          action: AuditAction.CREATE,
          entity_type: 'AcademicYear',
          entity_id: saved.id,
          tenant_id: tenantId,
          performed_by_user_id: userId,
          ip_address: context.ip,
          user_agent: context.userAgent,
          old_values: null,
          new_values: {
            name: saved.name,
            start_date: saved.start_date,
            end_date: saved.end_date,
            is_current: saved.is_current,
          },
        },
        manager,
      );

      return saved;
    });
  }

  async findAll(query: QueryAcademicYearDto, tenantId: string) {
    const page = query.page || 1;
    const limit = query.limit || 10;
    const skip = (page - 1) * limit;

    // `is_current` first: several callers (routine agenda, the class
    // list's year filter, subject-choices, generate-fees) pass no
    // limit/page and read `data[0]`/scan page 1 for the current year. A
    // tenant with more years than one page — every e2e spec calling
    // `POST /academic-years` adds one — pushed the current year past
    // page 1 under a pure `created_at DESC` sort, so those callers found
    // nothing and treated the tenant as having no current year at all.
    const [data, total] = await this.repo.findAndCount({
      where: { tenant_id: tenantId, deleted_at: IsNull() },
      order: { is_current: 'DESC', created_at: 'DESC' },
      skip,
      take: limit,
    });

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string, tenantId: string): Promise<AcademicYear> {
    const entity = await this.repo.findOne({
      where: { id, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!entity) {
      throw new NotFoundException('Academic year not found');
    }
    return entity;
  }

  async update(
    id: string,
    dto: UpdateAcademicYearDto,
    tenantId: string,
    userId: string | null = null,
    context: RequestContext = { ip: null, userAgent: null },
  ): Promise<AcademicYear> {
    return this.repo.manager.transaction(async (manager) => {
      const repo = manager.getRepository(AcademicYear);

      // Read (and lock) the pre-image inside the transaction, not before
      // it — a concurrent mutation committing between an outside-tx read
      // and this update would otherwise let the audit log's old_values
      // record a stale value.
      const existing = await repo.findOne({
        where: { id, tenant_id: tenantId, deleted_at: IsNull() },
        lock: { mode: 'pessimistic_write' },
      });
      if (!existing) {
        throw new NotFoundException('Academic year not found');
      }

      // If setting as current, unset all other current years for this
      // tenant — read them first (locked) so each displaced year gets its
      // own `true -> false` audit entry, same as setCurrent below.
      let displaced: AcademicYear[] = [];
      if (dto.is_current) {
        displaced = await repo.find({
          where: { tenant_id: tenantId, is_current: true, deleted_at: IsNull() },
          lock: { mode: 'pessimistic_write' },
        });
        await repo.update(
          { tenant_id: tenantId, is_current: true, deleted_at: IsNull() },
          { is_current: false },
        );
      }

      const updateData: any = { ...dto };
      if (dto.start_date) updateData.start_date = new Date(dto.start_date);
      if (dto.end_date) updateData.end_date = new Date(dto.end_date);

      await repo.update({ id, tenant_id: tenantId, deleted_at: IsNull() }, updateData);

      for (const year of displaced) {
        if (year.id === id) continue; // covered by the entry below
        await this.auditService.record(
          {
            action: AuditAction.UPDATE,
            entity_type: 'AcademicYear',
            entity_id: year.id,
            tenant_id: tenantId,
            performed_by_user_id: userId,
            ip_address: context.ip,
            user_agent: context.userAgent,
            old_values: { is_current: true },
            new_values: { is_current: false },
          },
          manager,
        );
      }

      // Diffed against exactly the fields this request changed — see the
      // identical reasoning on FeeStructureService.update.
      const changedKeys = Object.keys(updateData);
      if (changedKeys.length > 0) {
        const oldValues = Object.fromEntries(
          changedKeys.map((key) => [key, (existing as any)[key]]),
        );
        await this.auditService.record(
          {
            action: AuditAction.UPDATE,
            entity_type: 'AcademicYear',
            entity_id: id,
            tenant_id: tenantId,
            performed_by_user_id: userId,
            ip_address: context.ip,
            user_agent: context.userAgent,
            old_values: oldValues,
            new_values: updateData,
          },
          manager,
        );
      }

      return repo.findOne({
        where: { id, tenant_id: tenantId, deleted_at: IsNull() },
      }) as Promise<AcademicYear>;
    });
  }

  async remove(
    id: string,
    tenantId: string,
    userId: string | null = null,
    context: RequestContext = { ip: null, userAgent: null },
  ): Promise<void> {
    await this.repo.manager.transaction(async (manager) => {
      const repo = manager.getRepository(AcademicYear);

      // Read (and lock) the pre-image inside the transaction — see the
      // identical reasoning on update() above.
      const existing = await repo.findOne({
        where: { id, tenant_id: tenantId, deleted_at: IsNull() },
        lock: { mode: 'pessimistic_write' },
      });
      if (!existing) {
        throw new NotFoundException('Academic year not found');
      }

      // [68.2.12] Refuse the current year and any year still in use. Counted on
      // the transaction manager so the check runs inside the row lock.
      if (existing.is_current) {
        throw new ConflictException({
          message: 'This is the current academic year. Make another year current first.',
          details: { code: 'ACADEMIC_YEAR_CURRENT' },
        });
      }
      const [
        classes_count,
        fee_structures_count,
        enrollments_count,
        exams_count,
        student_fees_count,
      ] = await Promise.all([
        manager
          .getRepository(Class)
          .count({ where: { academic_year_id: id, tenant_id: tenantId } }),
        manager
          .getRepository(FeeStructure)
          .count({ where: { academic_year_id: id, tenant_id: tenantId } }),
        manager
          .getRepository(Enrollment)
          .count({ where: { academic_year_id: id, tenant_id: tenantId } }),
        manager.getRepository(Exam).count({ where: { academic_year_id: id, tenant_id: tenantId } }),
        manager
          .getRepository(StudentFee)
          // StudentFee has no tenant_id of its own; it is scoped through its student.
          // withDeleted: a removed student's (or removed) bill still carries payment and
          // wallet history that points at this year.
          .count({
            where: { academic_year_id: id, student: { tenant_id: tenantId } },
            withDeleted: true,
          }),
      ]);
      // Enrollments, exams and bills reference the year directly; their class
      // can belong to another year, so the class count does not cover them.
      if (
        classes_count +
          fee_structures_count +
          enrollments_count +
          exams_count +
          student_fees_count >
        0
      ) {
        throw new ConflictException({
          message:
            'This year still has classes, fee structures, enrollments, exams or bills. Remove them first.',
          details: {
            code: 'ACADEMIC_YEAR_IN_USE',
            classes_count,
            fee_structures_count,
            enrollments_count,
            exams_count,
            student_fees_count,
          },
        });
      }

      // [2702] acr_assessments.academic_year_id is a real FK with no relation
      // decorator, so assertNoLiveDependents cannot see it. The table has no deleted_at.
      const acr_assessments_count = await manager.count(AcrAssessment, {
        where: { academic_year_id: id, tenant_id: tenantId },
      });
      if (acr_assessments_count > 0) {
        throw new ConflictException({
          message: 'This year still has staff evaluations (ACR). Remove them first.',
          details: { code: 'ACADEMIC_YEAR_IN_USE', acr_assessments_count },
        });
      }

      // [2675] Everything else that points at the year blocks the delete too.
      // Terms, calendar events and subject offerings are year config: hidden with it.
      await assertNoLiveDependents(manager, AcademicYear, id, {
        code: 'ACADEMIC_YEAR_IN_USE',
        message: 'This year is still used by other records. Remove or reassign them first.',
        exclude: [
          'Class.academic_year',
          'FeeStructure.academic_year',
          'Enrollment.academic_year',
          'Exam.academic_year',
          'StudentFee.academic_year',
          'ClassSubject.academic_year',
          'AcademicTerm.academic_year',
          'CalendarEvent.academic_year',
          'StudentSubjectChoice.academic_year',
        ],
      });
      await dropClassSubjects(manager, tenantId, { academic_year_id: id });
      await manager.softDelete(AcademicTerm, { academic_year_id: id, tenant_id: tenantId });
      await manager.softDelete(CalendarEvent, { academic_year_id: id, tenant_id: tenantId });
      await repo.softDelete({ id, tenant_id: tenantId });

      await this.auditService.record(
        {
          action: AuditAction.DELETE,
          entity_type: 'AcademicYear',
          entity_id: id,
          tenant_id: tenantId,
          performed_by_user_id: userId,
          ip_address: context.ip,
          user_agent: context.userAgent,
          old_values: { name: existing.name, is_current: existing.is_current },
          new_values: null,
        },
        manager,
      );
    });
  }

  /**
   * Counts feeding the List page's Classes/Students columns and the
   * Detail page's Statistics tab. `students_count` counts ACTIVE
   * enrollments, not all Student rows — `Enrollment`'s own unique index
   * (one ACTIVE row per student per year) makes that a real distinct-
   * student count for the year, not an over-count from enrollment history.
   */
  async getStats(id: string, tenantId: string): Promise<AcademicYearStats> {
    await this.findOne(id, tenantId);

    const [classes_count, students_count, fee_structures_count] = await Promise.all([
      this.classRepo.count({ where: { academic_year_id: id, tenant_id: tenantId } }),
      this.enrollmentRepo.count({
        where: {
          academic_year_id: id,
          tenant_id: tenantId,
          enrollment_status: EnrollmentStatus.ACTIVE,
        },
      }),
      this.feeStructureRepo.count({
        where: { academic_year_id: id, tenant_id: tenantId },
      }),
    ]);

    return { classes_count, students_count, fee_structures_count };
  }

  private async count(manager: EntityManager, sql: string, params: unknown[]): Promise<number> {
    const rows: Array<{ n: string }> = await manager.query(sql, params);
    return Number(rows[0]?.n ?? 0);
  }

  /** [69.3.01] What closing the year blocks, warns about and freezes. One query per count. */
  private async buildClosePreview(
    manager: EntityManager,
    tenantId: string,
    year: AcademicYear,
  ): Promise<YearClosePreview> {
    const id = year.id;
    const T = [tenantId, id];
    const draft = PromotionRunStatus.DRAFT;
    const committed = PromotionRunStatus.COMMITTED;

    const [draftRuns, classesNotPromoted, studentsActive, groupsPending, duesRows, unpublished] =
      await Promise.all([
        this.count(
          manager,
          `SELECT count(*) n FROM promotion_runs WHERE tenant_id = $1 AND source_academic_year_id = $2 AND status = '${draft}'`,
          T,
        ),
        this.count(
          manager,
          `SELECT count(*) n FROM classes c
            WHERE c.tenant_id = $1 AND c.academic_year_id = $2 AND c.deleted_at IS NULL
              AND NOT EXISTS (SELECT 1 FROM promotion_runs r
                               WHERE r.tenant_id = c.tenant_id AND r.source_class_id = c.id
                                 AND r.source_academic_year_id = $2 AND r.status = '${committed}')`,
          T,
        ),
        this.count(
          manager,
          `SELECT count(*) n FROM enrollments e
            WHERE e.tenant_id = $1 AND e.academic_year_id = $2 AND e.enrollment_status::text = $3
              AND NOT EXISTS (SELECT 1 FROM enrollments e2
                                JOIN academic_years y2 ON y2.id = e2.academic_year_id AND y2.deleted_at IS NULL
                               WHERE e2.tenant_id = e.tenant_id AND e2.student_id = e.student_id
                                 AND y2.start_date > $4::date)`,
          [tenantId, id, EnrollmentStatus.ACTIVE, year.start_date],
        ),
        this.count(
          manager,
          `SELECT count(*) n FROM promotion_entries pe JOIN promotion_runs r ON r.id = pe.run_id
            WHERE r.tenant_id = $1 AND r.source_academic_year_id = $2 AND r.status = '${draft}'
              AND pe.group_name IS NULL`,
          T,
        ),
        // student_fees has no tenant_id: scope it through its student.
        manager.query(
          `SELECT COALESCE(SUM(sf.total_amount - sf.paid_amount - sf.discount_amount), 0) AS n
             FROM student_fees sf JOIN students s ON s.id = sf.student_id AND s.tenant_id = $1
            WHERE sf.academic_year_id = $2 AND sf.deleted_at IS NULL AND sf.status::text = ANY($3)`,
          [tenantId, id, OPEN_FEE_STATUSES],
        ) as Promise<Array<{ n: string }>>,
        this.count(
          manager,
          `SELECT count(*) n FROM exams WHERE tenant_id = $1 AND academic_year_id = $2
              AND deleted_at IS NULL AND status::text <> '${ExamStatus.PUBLISHED}'`,
          T,
        ),
      ]);

    const tables = [
      ...new Set(
        YEAR_SCOPED_WRITES.map((w) => YEAR_SCOPED_TABLES[w.entity]).filter((t): t is string => !!t),
      ),
    ];
    const cols: Array<{ table_name: string; column_name: string }> = await manager.query(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = ANY($1)
          AND column_name IN ('academic_year_id', 'source_academic_year_id', 'tenant_id', 'deleted_at')`,
      [tables],
    );
    const has = (t: string, c: string) =>
      cols.some((r) => r.table_name === t && r.column_name === c);
    // A promotion run belongs to its source year.
    const yearCol = (t: string) =>
      t === 'promotion_runs' ? 'source_academic_year_id' : 'academic_year_id';
    const freezes = await Promise.all(
      tables
        .filter((t) => has(t, yearCol(t)))
        .map(async (table) => {
          // $1 is always referenced so Postgres can type it; student_fees has no tenant_id,
          // so it is scoped through its student.
          const join =
            table === 'student_fees'
              ? 'JOIN students s ON s.id = x.student_id AND s.tenant_id = $1'
              : '';
          const where = [`x.${yearCol(table)} = $2`];
          if (!join)
            where.push(has(table, 'tenant_id') ? 'x.tenant_id = $1' : '$1::uuid IS NOT NULL');
          if (has(table, 'deleted_at')) where.push('x.deleted_at IS NULL');
          return {
            table,
            count: await this.count(
              manager,
              `SELECT count(*) n FROM "${table}" x ${join} WHERE ${where.join(' AND ')}`,
              T,
            ),
          };
        }),
    );
    freezes.push({
      table: 'attendance_sessions',
      count: await this.count(
        manager,
        `SELECT count(*) n FROM attendance_sessions WHERE tenant_id = $1 AND date BETWEEN $2::date AND $3::date`,
        [tenantId, year.start_date, year.end_date],
      ),
    });

    return {
      blocks: draftRuns > 0 ? [{ code: YEAR_CLOSE_BLOCK_DRAFT_PROMOTION, count: draftRuns }] : [],
      warnings: [
        { code: 'CLASSES_NOT_PROMOTED', count: classesNotPromoted },
        { code: 'STUDENTS_STILL_ACTIVE', count: studentsActive },
        { code: 'GROUPS_PENDING', count: groupsPending },
        // Whole paisa, never a float (Rule 26).
        { code: 'DUES_OUTSTANDING', count: toPaisa(duesRows[0]?.n ?? 0) },
        { code: 'RESULTS_UNPUBLISHED', count: unpublished },
      ],
      freezes,
    };
  }

  async closePreview(id: string, tenantId: string): Promise<YearClosePreview> {
    const year = await this.findOne(id, tenantId);
    return this.buildClosePreview(this.repo.manager, tenantId, year);
  }

  /** [69.3.01] Freeze the year. The controller checked step-up; `approval` lands in the audit row. */
  async close(
    id: string,
    tenantId: string,
    userId: string | null,
    context: RequestContext,
    approval: ApprovalContext,
  ): Promise<AcademicYear> {
    return this.repo.manager.transaction(async (manager) => {
      const repo = manager.getRepository(AcademicYear);
      const year = await repo.findOne({
        where: { id, tenant_id: tenantId, deleted_at: IsNull() },
        lock: { mode: 'pessimistic_write' },
      });
      if (!year) throw new NotFoundException('Academic year not found');
      if (year.closed_at) return year; // already closed: nothing to do
      if (year.is_current) {
        throw new ConflictException({
          message: 'This is the current academic year. Make another year current first.',
          details: { code: 'CANNOT_CLOSE_CURRENT_YEAR' },
        });
      }
      const preview = await this.buildClosePreview(manager, tenantId, year);
      if (preview.blocks.length > 0) {
        throw new ConflictException({
          message: 'A promotion run for this year is still a draft. Commit or delete it first.',
          details: { code: YEAR_CLOSE_BLOCK_DRAFT_PROMOTION, blocks: preview.blocks },
        });
      }

      const closed_at = new Date();
      await repo.update({ id, tenant_id: tenantId }, { closed_at, closed_by_user_id: userId });
      await this.auditService.recordApproved(
        {
          action: AuditAction.YEAR_CLOSE,
          entity_type: 'AcademicYear',
          entity_id: id,
          tenant_id: tenantId,
          performed_by_user_id: userId,
          approved_by_user_id: approval.approverId,
          approval_scope: approval.scope,
          ip_address: context.ip,
          user_agent: context.userAgent,
          old_values: { closed_at: null },
          new_values: { closed_at },
        },
        manager,
      );
      return repo.findOneOrFail({ where: { id, tenant_id: tenantId } });
    });
  }

  async reopen(
    id: string,
    tenantId: string,
    userId: string | null,
    context: RequestContext,
  ): Promise<AcademicYear> {
    return this.repo.manager.transaction(async (manager) => {
      const repo = manager.getRepository(AcademicYear);
      const year = await repo.findOne({
        where: { id, tenant_id: tenantId, deleted_at: IsNull() },
        lock: { mode: 'pessimistic_write' },
      });
      if (!year) throw new NotFoundException('Academic year not found');
      if (!year.closed_at) return year; // already open: nothing to do

      await repo.update({ id, tenant_id: tenantId }, { closed_at: null, closed_by_user_id: null });
      await this.auditService.record(
        {
          action: AuditAction.YEAR_REOPEN,
          entity_type: 'AcademicYear',
          entity_id: id,
          tenant_id: tenantId,
          performed_by_user_id: userId,
          ip_address: context.ip,
          user_agent: context.userAgent,
          old_values: { closed_at: year.closed_at },
          new_values: { closed_at: null },
        },
        manager,
      );
      return repo.findOneOrFail({ where: { id, tenant_id: tenantId } });
    });
  }

  /** [69.3.01] What the target year has before it is made current. */
  async readiness(id: string, tenantId: string): Promise<YearReadiness> {
    await this.findOne(id, tenantId);
    const m = this.repo.manager;
    const T = [tenantId, id];
    const [classes, teacher_assignments, committed_promotion_runs] = await Promise.all([
      this.count(
        m,
        `SELECT count(*) n FROM classes WHERE tenant_id = $1 AND academic_year_id = $2 AND deleted_at IS NULL`,
        T,
      ),
      this.count(
        m,
        `SELECT count(*) n FROM teacher_class_sections tcs
           JOIN class_sections cs ON cs.id = tcs.section_id AND cs.deleted_at IS NULL
           JOIN classes c ON c.id = cs.class_id AND c.deleted_at IS NULL
          WHERE tcs.tenant_id = $1 AND c.academic_year_id = $2`,
        T,
      ),
      this.count(
        m,
        `SELECT count(*) n FROM promotion_runs WHERE tenant_id = $1 AND target_academic_year_id = $2 AND status = '${PromotionRunStatus.COMMITTED}'`,
        T,
      ),
    ]);
    return { classes, teacher_assignments, committed_promotion_runs };
  }

  async setCurrent(
    id: string,
    tenantId: string,
    userId: string | null = null,
    context: RequestContext = { ip: null, userAgent: null },
  ): Promise<AcademicYear> {
    const target = await this.findOne(id, tenantId);
    // A closed year is read-only and never current (D4, D21).
    if (target.closed_at) throw yearClosed();

    return this.repo.manager.transaction(async (manager) => {
      const repo = manager.getRepository(AcademicYear);

      // The previously-current year(s) for this tenant — read before the
      // unset below so each gets its own `true -> false` audit entry,
      // distinct from the target year's `false -> true` entry.
      const previouslyCurrent = await repo.find({
        where: { tenant_id: tenantId, is_current: true, deleted_at: IsNull() },
      });

      // Unset all current years for this tenant
      if (previouslyCurrent.length > 0) {
        await repo.update(
          { tenant_id: tenantId, is_current: true, deleted_at: IsNull() },
          { is_current: false },
        );
      }

      // Set this one as current
      await repo.update({ id, tenant_id: tenantId, deleted_at: IsNull() }, { is_current: true });

      for (const year of previouslyCurrent) {
        if (year.id === id) continue; // already covered by the entry below
        await this.auditService.record(
          {
            action: AuditAction.UPDATE,
            entity_type: 'AcademicYear',
            entity_id: year.id,
            tenant_id: tenantId,
            performed_by_user_id: userId,
            ip_address: context.ip,
            user_agent: context.userAgent,
            old_values: { is_current: true },
            new_values: { is_current: false },
          },
          manager,
        );
      }

      const wasAlreadyCurrent = previouslyCurrent.some((year) => year.id === id);
      await this.auditService.record(
        {
          action: AuditAction.UPDATE,
          entity_type: 'AcademicYear',
          entity_id: id,
          tenant_id: tenantId,
          performed_by_user_id: userId,
          ip_address: context.ip,
          user_agent: context.userAgent,
          old_values: { is_current: wasAlreadyCurrent },
          new_values: { is_current: true },
        },
        manager,
      );

      return repo.findOne({
        where: { id, tenant_id: tenantId, deleted_at: IsNull() },
      }) as Promise<AcademicYear>;
    });
  }
}
