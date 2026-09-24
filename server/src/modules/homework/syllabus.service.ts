import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AuditAction, SyllabusTopicStatus } from '@biddaloy/shared';
import { SyllabusTopic } from './entities/syllabus-topic.entity';
import { Class } from '../academics/entities/class.entity';
import { Subject } from '../academics/entities/subject.entity';
import {
  CreateSyllabusTopicDto,
  UpdateSyllabusTopicDto,
  ReorderSyllabusTopicItemDto,
} from './dto/syllabus.dto';
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
  ) {}

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

  async create(
    dto: CreateSyllabusTopicDto,
    tenantId: string,
    userId: string | null = null,
    context: RequestContext = { ip: null, userAgent: null },
  ): Promise<SyllabusTopic> {
    await this.assertClassAndSubjectBelongToTenant(dto.class_id, dto.subject_id, tenantId);

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
    return this.repo.find({ where, order: { sequence: 'ASC' } });
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
    userId: string | null = null,
    context: RequestContext = { ip: null, userAgent: null },
  ): Promise<SyllabusTopic> {
    const existing = await this.findOne(id, tenantId);

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
    userId: string | null = null,
    context: RequestContext = { ip: null, userAgent: null },
  ): Promise<void> {
    const existing = await this.findOne(id, tenantId);

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
    userId: string | null = null,
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
