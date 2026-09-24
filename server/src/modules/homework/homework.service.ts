import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { HomeworkAssignmentStatus } from '@biddaloy/shared';
import { Homework } from './entities/homework.entity';
import { HomeworkAssignment } from './entities/homework-assignment.entity';
import { HomeworkAccessService } from './homework-access.service';
import { HomeworkNoticeService } from './homework-notice.service';
import {
  AssignHomeworkDto,
  CreateHomeworkDto,
  QueryHomeworkDto,
  UpdateHomeworkAssignmentDto,
} from './dto/homework.dto';

interface CallerContext {
  role: string;
  userId: string;
  tenantId: string;
}

/**
 * [22.3.1] Homework CRUD + assign/reassign. `HomeworkAccessService` is the
 * object-level gate on every mutating call — `@RequirePermissions` on the
 * controller is only the coarse "may attempt this at all" gate.
 */
@Injectable()
export class HomeworkService {
  private readonly logger = new Logger(HomeworkService.name);

  constructor(
    @InjectRepository(Homework)
    private readonly homeworkRepo: Repository<Homework>,
    @InjectRepository(HomeworkAssignment)
    private readonly assignmentRepo: Repository<HomeworkAssignment>,
    private readonly access: HomeworkAccessService,
    private readonly notice: HomeworkNoticeService,
  ) {}

  /** Shared by assign/reassign/updateAssignment — the section-or-student
   * access check, dispatched on whichever target the row actually has. */
  private async assertCanManageTarget(
    target: { section_id?: string | null; student_id?: string | null },
    homework: Homework,
    ctx: CallerContext,
  ): Promise<void> {
    if (target.section_id) {
      await this.access.assertCanManageSection(
        ctx.role,
        ctx.userId,
        target.section_id,
        homework.subject_id,
        ctx.tenantId,
      );
    } else {
      await this.access.assertCanManageStudent(
        ctx.role,
        ctx.userId,
        target.student_id as string,
        homework.subject_id,
        ctx.tenantId,
      );
    }
  }

  /** Shared by assign + reassign: exactly-one-target shape (D24), due_date
   * on/after assigned_date, object-level access, and the target actually
   * belongs to this homework's class (a rollup keys on homework.class_id,
   * so a target from a different class would silently corrupt it). */
  private async assertValidNewTarget(
    dto: AssignHomeworkDto,
    homework: Homework,
    ctx: CallerContext,
  ): Promise<void> {
    if (!!dto.section_id === !!dto.student_id) {
      throw new BadRequestException('Assign exactly one of section_id or student_id');
    }
    if (new Date(dto.due_date) < new Date(dto.assigned_date)) {
      throw new BadRequestException('due_date must be on or after assigned_date');
    }
    await this.assertCanManageTarget(dto, homework, ctx);
    await this.access.assertTargetInClass(
      dto.section_id,
      dto.student_id,
      homework.class_id,
      ctx.tenantId,
    );
  }

  async create(dto: CreateHomeworkDto, ctx: CallerContext): Promise<Homework> {
    // class_id/subject_id must belong to this tenant before any access
    // check runs against them — assertCanManageClass short-circuits without
    // a lookup for TENANT_WIDE_ROLES, so an ADMIN could otherwise create
    // homework pointing at another tenant's class/subject id.
    await this.access.assertClassAndSubjectInTenant(dto.class_id, dto.subject_id, ctx.tenantId);
    // Creation is scoped to a class/subject, not a section/student yet, so
    // the access check here is the class-teacher-or-tenant-role variant:
    // reuse assertCanManageSection with a null section check via the class's
    // own sections would over-fetch — instead a TEACHER must have SOME
    // TeacherClassSection row for this class_id/subject_id pair.
    await this.access.assertCanManageClass(
      ctx.role,
      ctx.userId,
      dto.class_id,
      dto.subject_id,
      ctx.tenantId,
    );

    const homework = this.homeworkRepo.create({
      subject_id: dto.subject_id,
      class_id: dto.class_id,
      title: dto.title,
      description: dto.description ?? null,
      grading_mode: dto.grading_mode,
      attachments: dto.attachments ?? [],
      tenant_id: ctx.tenantId,
    });
    return this.homeworkRepo.save(homework);
  }

  async findAll(query: QueryHomeworkDto, ctx: CallerContext): Promise<Homework[]> {
    const qb = this.homeworkRepo
      .createQueryBuilder('h')
      .where('h.tenant_id = :tenantId', { tenantId: ctx.tenantId });

    if (query.class_id) {
      qb.andWhere('h.class_id = :classId', { classId: query.class_id });
    }
    if (query.subject_id) {
      qb.andWhere('h.subject_id = :subjectId', { subjectId: query.subject_id });
    }
    if (query.section_id || query.status) {
      qb.innerJoin('homework_assignments', 'ha', 'ha.homework_id = h.id');
      if (query.section_id) {
        qb.andWhere('ha.section_id = :sectionId', { sectionId: query.section_id });
      }
      if (query.status) {
        qb.andWhere('ha.status = :status', { status: query.status });
      }
    }

    // Same object-level gate as mutations: TENANT_WIDE_ROLES see everything
    // in tenant, a TEACHER only sees homework for classes they're linked to
    // via teacher_class_sections (any section, any subject they teach).
    if (!this.access.isTenantWide(ctx.role)) {
      qb.innerJoin(
        'teacher_class_sections',
        'tcs',
        'tcs.tenant_id = :tenantId AND tcs.section_id IN ' +
          '(SELECT id FROM class_sections WHERE class_id = h.class_id AND tenant_id = :tenantId) ' +
          'AND (tcs.subject_id IS NULL OR tcs.subject_id = h.subject_id)',
      );
      qb.innerJoin(
        'teachers',
        't',
        't.id = tcs.teacher_id AND t.tenant_id = :tenantId AND t.user_id = :userId',
        { userId: ctx.userId },
      );
    }

    return qb.orderBy('h.created_at', 'DESC').getMany();
  }

  async findOne(id: string, ctx: CallerContext): Promise<Homework> {
    const homework = await this.homeworkRepo.findOne({
      where: { id, tenant_id: ctx.tenantId },
    });
    if (!homework) {
      throw new NotFoundException('Homework not found');
    }
    await this.access.assertCanManageClass(
      ctx.role,
      ctx.userId,
      homework.class_id,
      homework.subject_id,
      ctx.tenantId,
    );
    return homework;
  }

  async assign(
    homeworkId: string,
    dto: AssignHomeworkDto,
    ctx: CallerContext,
  ): Promise<HomeworkAssignment> {
    const homework = await this.findOne(homeworkId, ctx);

    await this.assertValidNewTarget(dto, homework, ctx);

    const assignment = this.assignmentRepo.create({
      homework_id: homework.id,
      section_id: dto.section_id ?? null,
      student_id: dto.student_id ?? null,
      assigned_date: dto.assigned_date,
      due_date: dto.due_date,
      status: HomeworkAssignmentStatus.ACTIVE,
      tenant_id: ctx.tenantId,
    });
    const saved = await this.assignmentRepo.save(assignment);

    // [22.3.3] Fire-and-forget would risk a silently-lost notice on a
    // transient error with no caller to see it; awaiting keeps it on the
    // request but must never turn a successful assignment into a 500 just
    // because a guardian's CommunicationLog insert failed.
    try {
      await this.notice.notifyAssignment(saved, homework);
    } catch (err) {
      // HomeworkNoticeService already logs internally per-guardian; this
      // catches a failure *before* that (e.g. loading target students), so
      // it still needs its own trace. The assignment itself is the source
      // of truth and must not be rolled back for a notification failure.
      this.logger.warn(
        `Failed to send assignment notice for assignment ${saved.id}: ${(err as Error).message}`,
      );
    }

    return saved;
  }

  /** D20 — reassignment always creates a new row rather than mutating the
   * old one. The old row is marked SUPERSEDED (shared/src/enums/homework.ts),
   * not left ACTIVE, so it stops showing up as a live assignment. */
  async reassign(
    assignmentId: string,
    dto: AssignHomeworkDto,
    ctx: CallerContext,
  ): Promise<HomeworkAssignment> {
    const old = await this.assignmentRepo.findOne({
      where: { id: assignmentId, tenant_id: ctx.tenantId },
    });
    if (!old) {
      throw new NotFoundException('Homework assignment not found');
    }
    if (old.status === HomeworkAssignmentStatus.SUPERSEDED) {
      throw new BadRequestException('This assignment has already been reassigned');
    }
    const homework = await this.findOne(old.homework_id, ctx);

    // The caller must be able to manage the OLD target too, not just the
    // new one — otherwise any teacher on the tenant could reassign (and so
    // supersede) another teacher's assignment by naming their own section
    // as the new target.
    await this.assertCanManageTarget(old, homework, ctx);
    await this.assertValidNewTarget(dto, homework, ctx);

    // Both writes in one transaction, and the old row's supersede is a
    // conditional UPDATE (not a save() of the already-fetched entity): a
    // crash between the two writes must never leave the homework with two
    // live ACTIVE rows, and two concurrent reassign calls for the same
    // assignmentId must not both pass the earlier SUPERSEDED check and each
    // create a new row — whichever loses the race gets 0 affected rows here
    // and aborts instead.
    return this.assignmentRepo.manager.transaction(async (manager) => {
      const repo = manager.getRepository(HomeworkAssignment);
      const result = await repo.update(
        { id: old.id, tenant_id: ctx.tenantId, status: Not(HomeworkAssignmentStatus.SUPERSEDED) },
        { status: HomeworkAssignmentStatus.SUPERSEDED },
      );
      if (!result.affected) {
        throw new BadRequestException('This assignment has already been reassigned');
      }
      return repo.save(
        repo.create({
          homework_id: old.homework_id,
          section_id: dto.section_id ?? null,
          student_id: dto.student_id ?? null,
          assigned_date: dto.assigned_date,
          due_date: dto.due_date,
          status: HomeworkAssignmentStatus.ACTIVE,
          tenant_id: ctx.tenantId,
        }),
      );
    });
  }

  /** `PATCH /homework-assignments/:id` — deactivate/reactivate only (Q10 D22). */
  async updateAssignment(
    assignmentId: string,
    dto: UpdateHomeworkAssignmentDto,
    ctx: CallerContext,
  ): Promise<HomeworkAssignment> {
    const assignment = await this.assignmentRepo.findOne({
      where: { id: assignmentId, tenant_id: ctx.tenantId },
    });
    if (!assignment) {
      throw new NotFoundException('Homework assignment not found');
    }
    const homework = await this.findOne(assignment.homework_id, ctx);

    await this.assertCanManageTarget(assignment, homework, ctx);

    if (assignment.status === HomeworkAssignmentStatus.SUPERSEDED) {
      throw new BadRequestException('A superseded assignment cannot be changed');
    }

    assignment.status = dto.status;
    return this.assignmentRepo.save(assignment);
  }
}
