import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { EntityManager, In, IsNull, Repository } from 'typeorm';
import { AuditAction, STUDY_PLAN_LIMITS } from '@biddaloy/shared';
import type { StudyPlanTemplateLesson } from '@biddaloy/shared';
import { StudyPlanTemplate } from './entities/study-plan-template.entity';
import { Subject } from '../academics/entities/subject.entity';
import { Class } from '../academics/entities/class.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { AuditService } from '../audit/audit.service';
import { RequestContext } from '../../common/request-context.util';
import { StudyPlanCaller, StudyPlansService } from './study-plans.service';
import { StudyPlanDetailDto } from './dto/study-plan.dto';
import {
  CopyStudyPlanTemplateDto,
  CreateStudyPlanTemplateDto,
  ListStudyPlanTemplatesQueryDto,
  StudyPlanTemplateDetailDto,
  StudyPlanTemplateLessonDto,
  StudyPlanTemplateListDto,
  StudyPlanTemplateSummaryDto,
  UpdateStudyPlanTemplateDto,
} from './dto/study-plan-template.dto';

const NO_CONTEXT: RequestContext = { ip: null, userAgent: null };

function badRequest(code: string, message: string): BadRequestException {
  return new BadRequestException({ message, details: { code } });
}

/**
 * [66.2.06/#2011] The school's study-plan template library (D4, D28). Tenant
 * rows keyed by class grade + subject code; lessons never carry a topic link.
 * Copying makes a plain plan through `StudyPlansService.create` and keeps no
 * reference back. Every query filters `tenant_id`.
 */
@Injectable()
export class StudyPlanTemplatesService {
  constructor(
    @InjectRepository(StudyPlanTemplate) private readonly repo: Repository<StudyPlanTemplate>,
    @InjectRepository(Subject) private readonly subjectRepo: Repository<Subject>,
    @InjectRepository(Class) private readonly classRepo: Repository<Class>,
    @InjectRepository(AcademicYear) private readonly yearRepo: Repository<AcademicYear>,
    private readonly plans: StudyPlansService,
    private readonly auditService: AuditService,
  ) {}

  private async findTemplate(id: string, tenantId: string): Promise<StudyPlanTemplate> {
    const t = await this.repo.findOne({
      where: { id, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!t) throw new NotFoundException(`Study plan template with ID "${id}" not found`);
    return t;
  }

  private async nameByCode(tenantId: string, codes: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(codes)];
    if (!unique.length) return new Map();
    const subjects = await this.subjectRepo.find({
      where: { tenant_id: tenantId, code: In(unique), deleted_at: IsNull() },
    });
    return new Map(subjects.map((s) => [s.code, s.name_en]));
  }

  private summary(t: StudyPlanTemplate, names: Map<string, string>): StudyPlanTemplateSummaryDto {
    return {
      id: t.id,
      name: t.name,
      class_grade: t.class_grade,
      subject_code: t.subject_code,
      subject_name: names.get(t.subject_code) ?? null,
      lesson_count: t.lessons.length,
      total_periods: t.lessons.reduce((n, l) => n + l.periods, 0),
      updated_at: t.updated_at,
    };
  }

  private async detail(t: StudyPlanTemplate): Promise<StudyPlanTemplateDetailDto> {
    const names = await this.nameByCode(t.tenant_id, [t.subject_code]);
    return { ...this.summary(t, names), lessons: t.lessons };
  }

  async list(
    query: ListStudyPlanTemplatesQueryDto,
    tenantId: string,
  ): Promise<StudyPlanTemplateListDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const qb = this.repo
      .createQueryBuilder('t')
      .where('t.tenant_id = :tenantId', { tenantId })
      .andWhere('t.deleted_at IS NULL');
    if (query.class_grade !== undefined) {
      qb.andWhere('t.class_grade = :grade', { grade: query.class_grade });
    }
    if (query.subject_code) {
      qb.andWhere('t.subject_code = :code', { code: query.subject_code });
    }
    if (query.q?.trim()) {
      const escaped = query.q.trim().replace(/[\\%_]/g, '\\$&');
      qb.andWhere(`t.name ILIKE :q ESCAPE '\\'`, { q: `%${escaped}%` });
    }
    const [rows, total] = await qb
      .orderBy('t.name', 'ASC')
      .addOrderBy('t.id', 'ASC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();
    const names = await this.nameByCode(
      tenantId,
      rows.map((r) => r.subject_code),
    );
    return {
      data: rows.map((r) => this.summary(r, names)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async get(id: string, tenantId: string): Promise<StudyPlanTemplateDetailDto> {
    return this.detail(await this.findTemplate(id, tenantId));
  }

  async create(
    dto: CreateStudyPlanTemplateDto,
    tenantId: string,
    userId: string | null = null,
    context: RequestContext = NO_CONTEXT,
  ): Promise<StudyPlanTemplateDetailDto> {
    const name = dto.name.trim();
    if (!name) throw badRequest('STUDY_PLAN_TEMPLATE_NAME_REQUIRED', 'Name is required');
    const lessons = this.normalizeLessons(dto.lessons);
    const saved = await this.run(async (manager) => {
      const row = await manager.getRepository(StudyPlanTemplate).save({
        tenant_id: tenantId,
        name,
        class_grade: dto.class_grade,
        subject_code: dto.subject_code,
        lessons,
      });
      await this.audit(manager, AuditAction.CREATE, row.id, tenantId, userId, context, null, {
        name,
        class_grade: dto.class_grade,
        subject_code: dto.subject_code,
        lesson_count: lessons.length,
      });
      return row;
    }, name);
    return this.get(saved.id, tenantId);
  }

  async update(
    id: string,
    dto: UpdateStudyPlanTemplateDto,
    tenantId: string,
    userId: string | null = null,
    context: RequestContext = NO_CONTEXT,
  ): Promise<StudyPlanTemplateDetailDto> {
    await this.findTemplate(id, tenantId);
    const lessons = dto.lessons ? this.normalizeLessons(dto.lessons) : undefined;
    const name = dto.name?.trim();
    if (name === '') throw badRequest('STUDY_PLAN_TEMPLATE_NAME_REQUIRED', 'Name is required');
    await this.run(async (manager) => {
      const live = await manager.getRepository(StudyPlanTemplate).findOne({
        where: { id, tenant_id: tenantId, deleted_at: IsNull() },
        lock: { mode: 'pessimistic_write' },
      });
      if (!live) throw new NotFoundException(`Study plan template with ID "${id}" not found`);
      const patch: Partial<StudyPlanTemplate> = {};
      if (name !== undefined) patch.name = name;
      if (dto.class_grade !== undefined) patch.class_grade = dto.class_grade;
      if (dto.subject_code !== undefined) patch.subject_code = dto.subject_code;
      if (lessons) patch.lessons = lessons;
      if (Object.keys(patch).length) {
        await manager.getRepository(StudyPlanTemplate).update({ id, tenant_id: tenantId }, patch);
      }
      await this.audit(
        manager,
        AuditAction.UPDATE,
        id,
        tenantId,
        userId,
        context,
        {
          name: live.name,
          class_grade: live.class_grade,
          subject_code: live.subject_code,
          lesson_count: live.lessons.length,
        },
        {
          ...(name !== undefined && { name }),
          ...(dto.class_grade !== undefined && { class_grade: dto.class_grade }),
          ...(dto.subject_code !== undefined && { subject_code: dto.subject_code }),
          ...(lessons && { lesson_count: lessons.length }),
        },
      );
    }, name);
    return this.get(id, tenantId);
  }

  async remove(
    id: string,
    tenantId: string,
    userId: string | null = null,
    context: RequestContext = NO_CONTEXT,
  ): Promise<void> {
    await this.repo.manager.transaction(async (manager) => {
      const live = await manager.getRepository(StudyPlanTemplate).findOne({
        where: { id, tenant_id: tenantId, deleted_at: IsNull() },
        lock: { mode: 'pessimistic_write' },
      });
      if (!live) throw new NotFoundException(`Study plan template with ID "${id}" not found`);
      await manager.getRepository(StudyPlanTemplate).softDelete({ id, tenant_id: tenantId });
      await this.audit(
        manager,
        AuditAction.DELETE,
        id,
        tenantId,
        userId,
        context,
        { name: live.name },
        null,
      );
    });
  }

  /** Save a plan the caller can read as a template: topic links dropped. */
  async fromPlan(
    planId: string,
    name: string | undefined,
    tenantId: string,
    caller: StudyPlanCaller,
  ): Promise<StudyPlanTemplateDetailDto> {
    const plan = await this.plans.findOneForCaller(planId, tenantId, caller);
    const cls = await this.classRepo.findOne({
      where: { id: plan.section.class_id, tenant_id: tenantId },
    });
    if (!cls?.numeric_grade) {
      throw badRequest(
        'STUDY_PLAN_TEMPLATE_NO_GRADE',
        'This plan class has no numeric grade, so it cannot be saved as a template.',
      );
    }
    let finalName = name?.trim();
    if (!finalName) {
      const year = await this.yearRepo.findOne({
        where: { id: plan.academic_year_id, tenant_id: tenantId },
      });
      finalName = `${plan.section.class_name} · ${plan.subject.name_en} · ${
        plan.term?.name ?? year?.name ?? ''
      }`.slice(0, STUDY_PLAN_LIMITS.templateNameMax);
    }
    const lessons = plan.lessons.map(({ id, title, periods, notes }) => ({
      id,
      title,
      periods,
      ...(notes ? { notes } : {}),
    }));
    return this.create(
      {
        name: finalName,
        class_grade: cls.numeric_grade,
        subject_code: plan.subject.code,
        lessons,
      },
      tenantId,
      caller.userId,
      caller.context ?? NO_CONTEXT,
    );
  }

  /** Copy into the caller's own new plan. No link back to the template. */
  async copy(
    id: string,
    dto: CopyStudyPlanTemplateDto,
    tenantId: string,
    caller: StudyPlanCaller,
  ): Promise<StudyPlanDetailDto> {
    const t = await this.findTemplate(id, tenantId);
    const lessons = t.lessons.map((l) => ({ ...l, id: randomUUID() }));
    return this.plans.create(
      {
        section_id: dto.section_id,
        subject_id: dto.subject_id,
        academic_term_id: dto.academic_term_id,
        lessons,
      },
      tenantId,
      caller,
    );
  }

  private normalizeLessons(input: StudyPlanTemplateLessonDto[]): StudyPlanTemplateLesson[] {
    const L = STUDY_PLAN_LIMITS;
    if (input.length > L.maxLessons) {
      throw badRequest(
        'STUDY_PLAN_LESSON_INVALID',
        `A template holds at most ${L.maxLessons} lessons.`,
      );
    }
    const seen = new Set<string>();
    return input.map((raw, i) => {
      if ((raw as { topic_id?: unknown }).topic_id !== undefined) {
        throw badRequest(
          'STUDY_PLAN_LESSON_INVALID',
          `Lesson ${i + 1}: templates cannot link to a topic.`,
        );
      }
      const title = typeof raw.title === 'string' ? raw.title.trim() : '';
      if (title.length < 1 || title.length > L.titleMax) {
        throw badRequest(
          'STUDY_PLAN_LESSON_INVALID',
          `Lesson ${i + 1}: title must be 1-${L.titleMax} characters.`,
        );
      }
      if (
        !Number.isInteger(raw.periods) ||
        raw.periods < L.periodsMin ||
        raw.periods > L.periodsMax
      ) {
        throw badRequest(
          'STUDY_PLAN_LESSON_INVALID',
          `Lesson ${i + 1}: periods must be a whole number ${L.periodsMin}-${L.periodsMax}.`,
        );
      }
      if (raw.notes && raw.notes.length > L.notesMax) {
        throw badRequest(
          'STUDY_PLAN_LESSON_INVALID',
          `Lesson ${i + 1}: notes are at most ${L.notesMax} characters.`,
        );
      }
      const id = raw.id || randomUUID();
      if (seen.has(id)) {
        throw badRequest('STUDY_PLAN_LESSON_INVALID', `Lesson ${i + 1}: duplicate lesson id.`);
      }
      seen.add(id);
      return { id, title, periods: raw.periods, ...(raw.notes ? { notes: raw.notes } : {}) };
    });
  }

  /** Runs `fn` in a transaction; a unique violation (23505) becomes a 409. */
  private async run<T>(fn: (m: EntityManager) => Promise<T>, name?: string): Promise<T> {
    try {
      return await this.repo.manager.transaction(fn);
    } catch (err) {
      if ((err as { code?: string } | null)?.code === '23505') {
        throw new ConflictException({
          message: `A study plan template named "${name ?? ''}" already exists.`,
          details: { code: 'STUDY_PLAN_TEMPLATE_NAME_TAKEN' },
        });
      }
      throw err;
    }
  }

  private audit(
    manager: EntityManager,
    action: AuditAction,
    id: string,
    tenantId: string,
    userId: string | null,
    context: RequestContext,
    oldValues: Record<string, unknown> | null,
    newValues: Record<string, unknown> | null,
  ) {
    return this.auditService.record(
      {
        action,
        entity_type: 'StudyPlanTemplate',
        entity_id: id,
        tenant_id: tenantId,
        performed_by_user_id: userId,
        ip_address: context.ip,
        user_agent: context.userAgent,
        old_values: oldValues,
        new_values: newValues,
      },
      manager,
    );
  }
}
