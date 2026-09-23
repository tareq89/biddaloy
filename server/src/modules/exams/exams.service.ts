import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { AuditAction } from '@biddaloy/shared';
import { Exam } from './entities/exam.entity';
import { Mark } from './entities/mark.entity';
import { CreateExamDto, UpdateExamDto, QueryExamDto } from './dto/exams.dto';
import { AuditService } from '../audit/audit.service';
import { RequestContext } from '../../common/request-context.util';

@Injectable()
export class ExamsService {
  constructor(
    @InjectRepository(Exam)
    private readonly repo: Repository<Exam>,
    @InjectRepository(Mark)
    private readonly markRepo: Repository<Mark>,
    private readonly auditService: AuditService,
  ) {}

  async create(
    dto: CreateExamDto,
    tenantId: string,
    userId: string | null = null,
    context: RequestContext = { ip: null, userAgent: null },
  ): Promise<Exam> {
    return this.repo.manager.transaction(async (manager) => {
      const repo = manager.getRepository(Exam);
      const entity = repo.create({
        name: dto.name,
        kind: dto.kind,
        academic_year_id: dto.academic_year_id,
        class_id: dto.class_id,
        academic_term_id: dto.academic_term_id ?? null,
        tenant_id: tenantId,
      });
      const saved = await repo.save(entity);

      await this.auditService.record(
        {
          action: AuditAction.CREATE,
          entity_type: 'Exam',
          entity_id: saved.id,
          tenant_id: tenantId,
          performed_by_user_id: userId,
          ip_address: context.ip,
          user_agent: context.userAgent,
          old_values: null,
          new_values: {
            name: saved.name,
            kind: saved.kind,
            academic_year_id: saved.academic_year_id,
            class_id: saved.class_id,
          },
        },
        manager,
      );

      return saved;
    });
  }

  async findAll(
    query: QueryExamDto,
    tenantId: string,
  ): Promise<{ data: Exam[]; total: number; page: number; limit: number; totalPages: number }> {
    const page = query.page || 1;
    const limit = query.limit || 10;
    const skip = (page - 1) * limit;

    const where: any = { tenant_id: tenantId, deleted_at: IsNull() };
    if (query.academic_year_id) where.academic_year_id = query.academic_year_id;
    if (query.class_id) where.class_id = query.class_id;

    const [data, total] = await this.repo.findAndCount({
      where,
      order: { created_at: 'DESC' },
      skip,
      take: limit,
    });

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string, tenantId: string): Promise<Exam> {
    const entity = await this.repo.findOne({
      where: { id, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!entity) {
      throw new NotFoundException(`Exam with ID "${id}" not found`);
    }
    return entity;
  }

  /** Whether any Mark row exists for this exam — once one does, class/year
   * can no longer change (issue's rule #1): moving an exam to a different
   * class/year after marks were entered would orphan those marks against
   * a class/year they were never entered for, rather than cascade them. */
  private async hasMarks(examId: string, tenantId: string): Promise<boolean> {
    const count = await this.markRepo.count({ where: { exam_id: examId, tenant_id: tenantId } });
    return count > 0;
  }

  async update(
    id: string,
    dto: UpdateExamDto,
    tenantId: string,
    userId: string | null = null,
    context: RequestContext = { ip: null, userAgent: null },
  ): Promise<Exam> {
    const existing = await this.findOne(id, tenantId);

    const changesClass = dto.class_id !== undefined && dto.class_id !== existing.class_id;
    const changesYear =
      dto.academic_year_id !== undefined && dto.academic_year_id !== existing.academic_year_id;
    if (changesClass || changesYear) {
      if (await this.hasMarks(id, tenantId)) {
        throw new ConflictException(
          `Cannot change class or academic year on exam "${id}": marks already exist for it.`,
        );
      }
    }

    const changedKeys = Object.keys(dto);
    if (changedKeys.length > 0) {
      await this.repo.manager.transaction(async (manager) => {
        const repo = manager.getRepository(Exam);
        const oldValues = Object.fromEntries(
          changedKeys.map((key) => [key, (existing as any)[key]]),
        );

        await repo.update({ id, tenant_id: tenantId }, dto);

        await this.auditService.record(
          {
            action: AuditAction.UPDATE,
            entity_type: 'Exam',
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
      const repo = manager.getRepository(Exam);
      await repo.softDelete({ id, tenant_id: tenantId });

      await this.auditService.record(
        {
          action: AuditAction.DELETE,
          entity_type: 'Exam',
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
}
