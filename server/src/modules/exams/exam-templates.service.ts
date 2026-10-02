import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, IsNull, Repository } from 'typeorm';
import { AuditAction } from '@biddaloy/shared';
import { ExamTemplate } from './entities/exam-template.entity';
import { ExamTemplateComponent } from './entities/exam-template-component.entity';
import { Subject } from '../academics/entities/subject.entity';
import { AuditService } from '../audit/audit.service';
import { RequestContext } from '../../common/request-context.util';
import {
  CreateExamTemplateDto,
  ExamTemplateDetailDto,
  ExamTemplateRowDto,
  ExamTemplateRowInputDto,
  ExamTemplateSummaryDto,
  UpdateExamTemplateDto,
} from './dto/exam-template.dto';

const NO_CONTEXT: RequestContext = { ip: null, userAgent: null };

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === '23505';
}

/**
 * [35.4.1] Exam templates CRUD. Templates are soft-deleted; their component
 * rows have no `deleted_at`, so delete and replace-rows go through explicit
 * tenant-scoped `delete` + `insert` — never `save()`/`remove()` on a template
 * with a loaded `components` relation (tenant-filtered OneToMany orphaning).
 */
@Injectable()
export class ExamTemplatesService {
  constructor(
    @InjectRepository(ExamTemplate) private readonly repo: Repository<ExamTemplate>,
    @InjectRepository(ExamTemplateComponent)
    private readonly componentRepo: Repository<ExamTemplateComponent>,
    @InjectRepository(Subject) private readonly subjectRepo: Repository<Subject>,
    private readonly auditService: AuditService,
  ) {}

  private async findTemplate(id: string, tenantId: string): Promise<ExamTemplate> {
    const t = await this.repo.findOne({
      where: { id, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!t) throw new NotFoundException(`Exam template with ID "${id}" not found`);
    return t;
  }

  async list(tenantId: string): Promise<ExamTemplateSummaryDto[]> {
    const templates = await this.repo.find({
      where: { tenant_id: tenantId, deleted_at: IsNull() },
      order: { name: 'ASC' },
    });
    if (!templates.length) return [];
    const comps = await this.componentRepo.find({
      where: { tenant_id: tenantId, template_id: In(templates.map((t) => t.id)) },
      select: { template_id: true, class_grade: true, subject_code: true },
    });
    return templates.map((t) => {
      const mine = comps.filter((c) => c.template_id === t.id);
      return {
        id: t.id,
        name: t.name,
        kind: t.kind,
        rowCount: new Set(mine.map((c) => `${c.class_grade}|${c.subject_code}`)).size,
        classGrades: [...new Set(mine.map((c) => c.class_grade))].sort((a, b) => a - b),
      };
    });
  }

  async get(id: string, tenantId: string): Promise<ExamTemplateDetailDto> {
    const t = await this.findTemplate(id, tenantId);
    const comps = await this.componentRepo.find({
      where: { tenant_id: tenantId, template_id: id },
      order: { class_grade: 'ASC', subject_code: 'ASC', sequence: 'ASC' },
    });
    const codes = [...new Set(comps.map((c) => c.subject_code))];
    const subjects = codes.length
      ? await this.subjectRepo.find({
          where: { tenant_id: tenantId, code: In(codes), deleted_at: IsNull() },
        })
      : [];
    const nameByCode = new Map(subjects.map((s) => [s.code, s.name_en]));

    const rows = new Map<string, ExamTemplateRowDto>();
    for (const c of comps) {
      const key = `${c.class_grade}|${c.subject_code}`;
      let row = rows.get(key);
      if (!row) {
        row = {
          classGrade: c.class_grade,
          subjectCode: c.subject_code,
          subjectName: nameByCode.get(c.subject_code) ?? null,
          components: [],
        };
        rows.set(key, row);
      }
      row.components.push({
        name: c.name,
        kind: c.kind,
        full: Number(c.full_marks),
        pass: Number(c.pass_marks),
        sequence: c.sequence,
      });
    }
    return { id: t.id, name: t.name, kind: t.kind, rows: [...rows.values()] };
  }

  async create(
    dto: CreateExamTemplateDto,
    tenantId: string,
    userId: string | null = null,
    context: RequestContext = NO_CONTEXT,
  ): Promise<ExamTemplateDetailDto> {
    const id = await this.run(async (manager) => {
      const saved = await manager
        .getRepository(ExamTemplate)
        .save({ tenant_id: tenantId, name: dto.name, kind: dto.kind });
      await this.audit(manager, AuditAction.CREATE, saved.id, tenantId, userId, context, null, {
        name: dto.name,
        kind: dto.kind,
      });
      return saved.id;
    }, dto.name);
    return this.get(id, tenantId);
  }

  async update(
    id: string,
    dto: UpdateExamTemplateDto,
    tenantId: string,
    userId: string | null = null,
    context: RequestContext = NO_CONTEXT,
  ): Promise<ExamTemplateDetailDto> {
    const existing = await this.findTemplate(id, tenantId);
    if (dto.rows) this.validateRows(dto.rows);

    await this.run(async (manager) => {
      const patch: Partial<ExamTemplate> = {};
      if (dto.name !== undefined) patch.name = dto.name;
      if (dto.kind !== undefined) patch.kind = dto.kind;
      if (Object.keys(patch).length) {
        await manager.getRepository(ExamTemplate).update({ id, tenant_id: tenantId }, patch);
      }
      if (dto.rows) {
        const compRepo = manager.getRepository(ExamTemplateComponent);
        await compRepo.delete({ tenant_id: tenantId, template_id: id });
        const lines = dto.rows.flatMap((r) =>
          r.components.map((c, sequence) => ({
            tenant_id: tenantId,
            template_id: id,
            class_grade: r.classGrade,
            subject_code: r.subjectCode,
            sequence,
            name: c.name,
            kind: c.kind,
            full_marks: String(c.full),
            pass_marks: String(c.pass),
          })),
        );
        if (lines.length) await compRepo.insert(lines);
      }
      await this.audit(
        manager,
        AuditAction.UPDATE,
        id,
        tenantId,
        userId,
        context,
        { name: existing.name, kind: existing.kind },
        {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.kind !== undefined && { kind: dto.kind }),
          ...(dto.rows && { rows_replaced: dto.rows.length }),
        },
      );
    }, dto.name);
    return this.get(id, tenantId);
  }

  async remove(
    id: string,
    tenantId: string,
    userId: string | null = null,
    context: RequestContext = NO_CONTEXT,
  ): Promise<void> {
    const existing = await this.findTemplate(id, tenantId);
    await this.repo.manager.transaction(async (manager) => {
      // Components have no deleted_at and nothing references them: hard-delete.
      await manager
        .getRepository(ExamTemplateComponent)
        .delete({ tenant_id: tenantId, template_id: id });
      await manager.getRepository(ExamTemplate).softDelete({ id, tenant_id: tenantId });
      await this.audit(
        manager,
        AuditAction.DELETE,
        id,
        tenantId,
        userId,
        context,
        {
          name: existing.name,
        },
        null,
      );
    });
  }

  /**
   * [for #1282] Read-only component lines for one class grade and a set of
   * subject codes, ordered by subject code then sequence. Tenant-scoped;
   * returns [] for a deleted or foreign template.
   */
  async componentsFor(
    manager: EntityManager,
    tenantId: string,
    templateId: string,
    classGrade: number,
    subjectCodes: string[],
  ): Promise<ExamTemplateComponent[]> {
    if (!subjectCodes.length) return [];
    const template = await manager.getRepository(ExamTemplate).findOne({
      where: { id: templateId, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!template) return [];
    return manager.getRepository(ExamTemplateComponent).find({
      where: {
        tenant_id: tenantId,
        template_id: templateId,
        class_grade: classGrade,
        subject_code: In(subjectCodes),
      },
      order: { subject_code: 'ASC', sequence: 'ASC' },
    });
  }

  private validateRows(rows: ExamTemplateRowInputDto[]): void {
    const seenRows = new Set<string>();
    for (const r of rows) {
      const rowKey = `${r.classGrade}|${r.subjectCode}`;
      if (seenRows.has(rowKey)) {
        throw new BadRequestException(
          `Duplicate row for class ${r.classGrade} and subject "${r.subjectCode}".`,
        );
      }
      seenRows.add(rowKey);
      const names = new Set<string>();
      for (const c of r.components) {
        if (c.full <= 0) throw new BadRequestException('full must be greater than 0.');
        if (c.pass < 0 || c.pass > c.full) {
          throw new BadRequestException(
            `pass must be between 0 and full for "${c.name}" (class ${r.classGrade}, ${r.subjectCode}).`,
          );
        }
        if (names.has(c.name)) {
          throw new BadRequestException(
            `Duplicate component name "${c.name}" for class ${r.classGrade}, ${r.subjectCode}.`,
          );
        }
        names.add(c.name);
      }
    }
  }

  /** Runs `fn` in a transaction; a unique violation (23505) becomes a 409. */
  private async run<T>(fn: (m: EntityManager) => Promise<T>, name?: string): Promise<T> {
    try {
      return await this.repo.manager.transaction(fn);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException(
          `An exam template named "${name ?? ''}" already exists, or a row repeats a component name.`,
        );
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
        entity_type: 'ExamTemplate',
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
