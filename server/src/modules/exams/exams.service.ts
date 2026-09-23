import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, QueryFailedError } from 'typeorm';
import { AuditAction } from '@biddaloy/shared';
import { Exam } from './entities/exam.entity';
import { Mark } from './entities/mark.entity';
import { Class } from '../academics/entities/class.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { AcademicTerm } from '../calendar/entities/academic-term.entity';
import { CreateExamDto, UpdateExamDto, QueryExamDto } from './dto/exams.dto';
import { AuditService } from '../audit/audit.service';
import { RequestContext } from '../../common/request-context.util';

/** Postgres unique-violation code — used to turn a race-condition insert
 * conflict into a 409 instead of letting it fall through to a raw 500. */
const PG_UNIQUE_VIOLATION = '23505';

function isUniqueViolation(err: unknown): boolean {
  return err instanceof QueryFailedError && (err as any).code === PG_UNIQUE_VIOLATION;
}

@Injectable()
export class ExamsService {
  constructor(
    @InjectRepository(Exam)
    private readonly repo: Repository<Exam>,
    @InjectRepository(Mark)
    private readonly markRepo: Repository<Mark>,
    @InjectRepository(Class)
    private readonly classRepo: Repository<Class>,
    @InjectRepository(AcademicYear)
    private readonly yearRepo: Repository<AcademicYear>,
    @InjectRepository(AcademicTerm)
    private readonly termRepo: Repository<AcademicTerm>,
    private readonly auditService: AuditService,
  ) {}

  /** IDOR guard: every client-supplied foreign key on an Exam must belong
   * to the caller's own tenant, and a class must belong to the given
   * year, and a term (if any) must belong to that same year — the
   * migration's FKs are single-column and don't themselves enforce
   * tenant or cross-reference consistency. */
  private async assertReferencesBelongToTenant(
    tenantId: string,
    refs: { classId: string; academicYearId: string; academicTermId?: string | null },
  ): Promise<void> {
    const cls = await this.classRepo.findOne({
      where: { id: refs.classId, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!cls) {
      throw new BadRequestException(`Class "${refs.classId}" not found for this tenant.`);
    }
    if (cls.academic_year_id !== refs.academicYearId) {
      throw new BadRequestException(
        `Class "${refs.classId}" does not belong to academic year "${refs.academicYearId}".`,
      );
    }

    const year = await this.yearRepo.findOne({
      where: { id: refs.academicYearId, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!year) {
      throw new BadRequestException(
        `Academic year "${refs.academicYearId}" not found for this tenant.`,
      );
    }

    if (refs.academicTermId) {
      const term = await this.termRepo.findOne({
        where: {
          id: refs.academicTermId,
          tenant_id: tenantId,
          academic_year_id: refs.academicYearId,
          deleted_at: IsNull(),
        },
      });
      if (!term) {
        throw new BadRequestException(
          `Academic term "${refs.academicTermId}" not found for this tenant/year.`,
        );
      }
    }
  }

  async create(
    dto: CreateExamDto,
    tenantId: string,
    userId: string | null = null,
    context: RequestContext = { ip: null, userAgent: null },
  ): Promise<Exam> {
    await this.assertReferencesBelongToTenant(tenantId, {
      classId: dto.class_id,
      academicYearId: dto.academic_year_id,
      academicTermId: dto.academic_term_id,
    });

    try {
      return await this.repo.manager.transaction(async (manager) => {
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
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException(
          `An exam named "${dto.name}" already exists for this class and academic year.`,
        );
      }
      throw err;
    }
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

    // Same IDOR guard as create() — re-validated whenever any of these
    // three fields is present in the PATCH, even the ones that didn't
    // "change" from the exam's own recorded value, since a caller could
    // otherwise smuggle in a same-value-looking id from another tenant.
    if (
      dto.class_id !== undefined ||
      dto.academic_year_id !== undefined ||
      dto.academic_term_id !== undefined
    ) {
      await this.assertReferencesBelongToTenant(tenantId, {
        classId: dto.class_id ?? existing.class_id,
        academicYearId: dto.academic_year_id ?? existing.academic_year_id,
        academicTermId:
          dto.academic_term_id !== undefined ? dto.academic_term_id : existing.academic_term_id,
      });
    }

    const changedKeys = Object.keys(dto);
    if (changedKeys.length > 0) {
      try {
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
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new ConflictException(
            `An exam with this name already exists for this class and academic year.`,
          );
        }
        throw err;
      }
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
