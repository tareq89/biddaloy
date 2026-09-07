import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { AcademicYear } from './entities/academic-year.entity';
import { Class } from './entities/class.entity';
import { Enrollment } from '../students/entities/enrollment.entity';
import { FeeStructure } from '../fees/entities/fee-structure.entity';
import { CreateAcademicYearDto } from './dto/create-academic-year.dto';
import { UpdateAcademicYearDto } from './dto/update-academic-year.dto';
import { QueryAcademicYearDto } from './dto/query-academic-year.dto';
import { EnrollmentStatus, AuditAction } from '@biddaloy/shared';
import { AuditService } from '../audit/audit.service';
import { RequestContext } from '../../common/request-context.util';

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

    const [data, total] = await this.repo.findAndCount({
      where: { tenant_id: tenantId, deleted_at: IsNull() },
      order: { created_at: 'DESC' },
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
      throw new NotFoundException(`Academic year with ID "${id}" not found`);
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
        throw new NotFoundException(`Academic year with ID "${id}" not found`);
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
        throw new NotFoundException(`Academic year with ID "${id}" not found`);
      }

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

  async setCurrent(
    id: string,
    tenantId: string,
    userId: string | null = null,
    context: RequestContext = { ip: null, userAgent: null },
  ): Promise<AcademicYear> {
    await this.findOne(id, tenantId);

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
