import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { StudyPlan } from '../study-plans/entities/study-plan.entity';
import { PlanScheduleService } from '../study-plans/plan-schedule.service';
import {
  AuditAction,
  Permission,
  SyllabusTopicStatus,
  UserRole,
  hasTenantScope,
  roleHasPermission,
} from '@biddaloy/shared';
import { SyllabusTopic } from './entities/syllabus-topic.entity';
import { Class } from '../academics/entities/class.entity';
import { Subject } from '../academics/entities/subject.entity';
import {
  CreateSyllabusTopicDto,
  UpdateSyllabusTopicDto,
  ReorderSyllabusTopicItemDto,
} from './dto/syllabus.dto';
import { TeacherScopeService } from '../classes/teacher-scope.service';
import { AuditService } from '../audit/audit.service';
import { RequestContext } from '../../common/request-context.util';

@Injectable()
export class SyllabusService {
  constructor(
    @InjectRepository(SyllabusTopic)
    private readonly repo: Repository<SyllabusTopic>,
    @InjectRepository(Class)
    private readonly classRepo: Repository<Class>,
    @InjectRepository(Subject)
    private readonly subjectRepo: Repository<Subject>,
    private readonly auditService: AuditService,
    private readonly teacherScope: TeacherScopeService,
    @InjectRepository(StudyPlan)
    private readonly planRepo: Repository<StudyPlan>,
    private readonly planSchedule: PlanScheduleService,
  ) {}

  /**
   * [66.2.07/D31] Per topic of one class x subject: in how many sections a live
   * study plan links it (`sections_planned`) and in how many of those every
   * linked lesson is DONE (`sections_taught`). Derived only; topic status is
   * never touched. A section with several plans (year + terms) counts once.
   * ponytail: one schedule per plan (a class has few sections); cache if lists get slow.
   */
  async coverageFor(
    classId: string,
    subjectId: string,
    tenantId: string,
  ): Promise<Map<string, { sections_planned: number; sections_taught: number }>> {
    const plans = await this.planRepo
      .createQueryBuilder('p')
      .innerJoin(
        'class_sections',
        'cs',
        'cs.id = p.section_id AND cs.tenant_id = :tenantId AND cs.class_id = :classId AND cs.deleted_at IS NULL',
        { tenantId, classId },
      )
      .where('p.tenant_id = :tenantId AND p.subject_id = :subjectId', { tenantId, subjectId })
      .getMany();

    // section -> topic -> "every linked lesson so far is DONE"
    const bySection = new Map<string, Map<string, boolean>>();
    for (const plan of plans) {
      if (!plan.lessons.some((l) => l.topic_id)) continue;
      let done = new Map<string, string>();
      try {
        const { raw } = await this.planSchedule.scheduleFor(plan, tenantId);
        done = new Map(raw.lessons.map((l) => [l.id, l.status]));
      } catch (err) {
        if (!(err instanceof NotFoundException)) throw err; // term/year gone: nothing counts as done
      }
      const topics = bySection.get(plan.section_id) ?? new Map<string, boolean>();
      for (const lesson of plan.lessons) {
        if (!lesson.topic_id) continue;
        const isDone = done.get(lesson.id) === 'DONE';
        topics.set(lesson.topic_id, (topics.get(lesson.topic_id) ?? true) && isDone);
      }
      bySection.set(plan.section_id, topics);
    }

    const out = new Map<string, { sections_planned: number; sections_taught: number }>();
    for (const topics of bySection.values()) {
      for (const [topicId, allDone] of topics) {
        const c = out.get(topicId) ?? { sections_planned: 0, sections_taught: 0 };
        c.sections_planned += 1;
        if (allDone) c.sections_taught += 1;
        out.set(topicId, c);
      }
    }
    return out;
  }

  /** IDOR guard: class_id/subject_id must belong to the caller's own
   * tenant — mirrors ExamComponentsService.assertSubjectBelongsToTenant. */
  private async assertClassAndSubjectBelongToTenant(
    classId: string,
    subjectId: string,
    tenantId: string,
  ): Promise<void> {
    const [klass, subject] = await Promise.all([
      this.classRepo.findOne({ where: { id: classId, tenant_id: tenantId } }),
      this.subjectRepo.findOne({ where: { id: subjectId, tenant_id: tenantId } }),
    ]);
    if (!klass) {
      throw new BadRequestException(`Class "${classId}" not found for this tenant.`);
    }
    if (!subject) {
      throw new BadRequestException(`Subject "${subjectId}" not found for this tenant.`);
    }
  }

  /** D16: a tenant-wide role with SYLLABUS_MANAGE (ADMIN, SUPER_ADMIN) writes
   * anywhere; a TEACHER only for a class x subject they hold a SUBJECT_TEACHER
   * row for. `hasTenantScope`, not `hasTenantDataScope`: SUPER_ADMIN could
   * write syllabus topics before D16 and this gate must not take that away. */
  private async assertCanWrite(
    role: string,
    userId: string,
    tenantId: string,
    classId: string,
    subjectId: string,
  ): Promise<void> {
    if (hasTenantScope(role) && roleHasPermission(role, Permission.SYLLABUS_MANAGE)) return;
    if (
      role === UserRole.TEACHER &&
      (await this.teacherScope.teachesSubjectInClass({ userId, tenantId, classId, subjectId }))
    ) {
      return;
    }
    throw new ForbiddenException({
      message: 'You can only change syllabus topics of a class and subject you teach.',
      details: { code: 'SYLLABUS_OUT_OF_SCOPE' },
    });
  }

  async create(
    dto: CreateSyllabusTopicDto,
    tenantId: string,
    role: string,
    userId: string,
    context: RequestContext = { ip: null, userAgent: null },
  ): Promise<SyllabusTopic> {
    await this.assertClassAndSubjectBelongToTenant(dto.class_id, dto.subject_id, tenantId);
    await this.assertCanWrite(role, userId, tenantId, dto.class_id, dto.subject_id);

    return this.repo.manager.transaction(async (manager) => {
      const repo = manager.getRepository(SyllabusTopic);
      const entity = repo.create({
        class_id: dto.class_id,
        subject_id: dto.subject_id,
        name: dto.name,
        description: dto.description ?? null,
        sequence: dto.sequence,
        status: dto.status ?? SyllabusTopicStatus.PLANNED,
        tenant_id: tenantId,
      });
      const saved = await repo.save(entity);

      await this.auditService.record(
        {
          action: AuditAction.CREATE,
          entity_type: 'SyllabusTopic',
          entity_id: saved.id,
          tenant_id: tenantId,
          performed_by_user_id: userId,
          ip_address: context.ip,
          user_agent: context.userAgent,
          old_values: null,
          new_values: { name: saved.name, class_id: saved.class_id, subject_id: saved.subject_id },
        },
        manager,
      );

      return saved;
    });
  }

  async findAll(tenantId: string, classId?: string, subjectId?: string): Promise<SyllabusTopic[]> {
    const where: Record<string, unknown> = { tenant_id: tenantId };
    if (classId) where.class_id = classId;
    if (subjectId) where.subject_id = subjectId;
    return this.repo.find({
      where: { ...where, subject: { tenant_id: tenantId } },
      relations: { subject: true },
      // `SyllabusTopic` has no deleted_at of its own, so this only keeps a
      // soft-deleted subject's name on its topics.
      withDeleted: true,
      order: { sequence: 'ASC' },
    });
  }

  async findOne(id: string, tenantId: string): Promise<SyllabusTopic> {
    const entity = await this.repo.findOne({ where: { id, tenant_id: tenantId } });
    if (!entity) {
      throw new NotFoundException(`Syllabus topic with ID "${id}" not found`);
    }
    return entity;
  }

  async update(
    id: string,
    dto: UpdateSyllabusTopicDto,
    tenantId: string,
    role: string,
    userId: string,
    context: RequestContext = { ip: null, userAgent: null },
  ): Promise<SyllabusTopic> {
    const existing = await this.findOne(id, tenantId);
    await this.assertCanWrite(role, userId, tenantId, existing.class_id, existing.subject_id);

    const changedKeys = Object.keys(dto);
    if (changedKeys.length > 0) {
      await this.repo.manager.transaction(async (manager) => {
        const repo = manager.getRepository(SyllabusTopic);
        const oldValues = Object.fromEntries(
          changedKeys.map((key) => [key, (existing as any)[key]]),
        );

        await repo.update({ id, tenant_id: tenantId }, dto);

        await this.auditService.record(
          {
            action: AuditAction.UPDATE,
            entity_type: 'SyllabusTopic',
            entity_id: id,
            tenant_id: tenantId,
            performed_by_user_id: userId,
            ip_address: context.ip,
            user_agent: context.userAgent,
            old_values: oldValues,
            new_values: { ...dto },
          },
          manager,
        );
      });
    }

    return this.findOne(id, tenantId);
  }

  async remove(
    id: string,
    tenantId: string,
    role: string,
    userId: string,
    context: RequestContext = { ip: null, userAgent: null },
  ): Promise<void> {
    const existing = await this.findOne(id, tenantId);
    await this.assertCanWrite(role, userId, tenantId, existing.class_id, existing.subject_id);

    await this.repo.manager.transaction(async (manager) => {
      const repo = manager.getRepository(SyllabusTopic);
      await repo.delete({ id, tenant_id: tenantId });

      await this.auditService.record(
        {
          action: AuditAction.DELETE,
          entity_type: 'SyllabusTopic',
          entity_id: id,
          tenant_id: tenantId,
          performed_by_user_id: userId,
          ip_address: context.ip,
          user_agent: context.userAgent,
          old_values: { name: existing.name },
          new_values: null,
        },
        manager,
      );
    });
  }

  /** Bulk sequence rewrite: every id must exist in this tenant. Unlike
   * AcademicTermsService.reorder, this does not require `items` to cover
   * every topic of a class/subject — a caller may resequence a subset.
   * There's no unique index on (class_id, subject_id, sequence), so a
   * single-pass update is safe (no unique-constraint collision risk). */
  async reorder(
    items: ReorderSyllabusTopicItemDto[],
    tenantId: string,
    role: string,
    userId: string,
    context: RequestContext = { ip: null, userAgent: null },
  ): Promise<SyllabusTopic[]> {
    const ids = items.map((item) => item.id);
    const uniqueIds = new Set(ids);
    if (uniqueIds.size !== ids.length) {
      throw new BadRequestException('Duplicate id in reorder payload.');
    }

    return this.repo.manager.transaction(async (manager) => {
      const repo = manager.getRepository(SyllabusTopic);
      const topics = await repo.find({ where: { id: In(ids), tenant_id: tenantId } });
      const tenantIds = new Set(topics.map((t) => t.id));
      const missing = ids.filter((id) => !tenantIds.has(id));
      if (missing.length > 0) {
        throw new NotFoundException(
          `Syllabus topic(s) not found for this tenant: ${missing.join(', ')}`,
        );
      }

      // All-or-nothing: check every distinct class x subject before any update.
      const pairs = new Map(topics.map((t) => [`${t.class_id}|${t.subject_id}`, t]));
      await Promise.all(
        Array.from(pairs.values(), (t) =>
          this.assertCanWrite(role, userId, tenantId, t.class_id, t.subject_id),
        ),
      );

      for (const item of items) {
        await repo.update({ id: item.id, tenant_id: tenantId }, { sequence: item.sequence });
      }

      await this.auditService.record(
        {
          action: AuditAction.UPDATE,
          entity_type: 'SyllabusTopic',
          entity_id: ids[0],
          tenant_id: tenantId,
          performed_by_user_id: userId,
          ip_address: context.ip,
          user_agent: context.userAgent,
          old_values: null,
          new_values: { reordered_ids: ids, reordered: items },
        },
        manager,
      );

      return repo
        .createQueryBuilder('t')
        .where('t.id IN (:...ids)', { ids })
        .andWhere('t.tenant_id = :tenantId', { tenantId })
        .orderBy('t.sequence', 'ASC')
        .getMany();
    });
  }
}
