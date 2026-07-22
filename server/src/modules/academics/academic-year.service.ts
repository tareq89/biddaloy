import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { AcademicYear } from './entities/academic-year.entity';
import { CreateAcademicYearDto } from './dto/create-academic-year.dto';
import { UpdateAcademicYearDto } from './dto/update-academic-year.dto';
import { QueryAcademicYearDto } from './dto/query-academic-year.dto';

@Injectable()
export class AcademicYearService {
  constructor(
    @InjectRepository(AcademicYear)
    private readonly repo: Repository<AcademicYear>,
  ) {}

  async create(dto: CreateAcademicYearDto, tenantId: string): Promise<AcademicYear> {
    return this.repo.manager.transaction(async (manager) => {
      const repo = manager.getRepository(AcademicYear);

      // If setting as current, unset all other current years for this tenant
      if (dto.is_current) {
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

      return repo.save(academicYear);
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

  async update(id: string, dto: UpdateAcademicYearDto, tenantId: string): Promise<AcademicYear> {
    await this.findOne(id, tenantId);

    return this.repo.manager.transaction(async (manager) => {
      const repo = manager.getRepository(AcademicYear);

      // If setting as current, unset all other current years for this tenant
      if (dto.is_current) {
        await repo.update(
          { tenant_id: tenantId, is_current: true, deleted_at: IsNull() },
          { is_current: false },
        );
      }

      const updateData: any = { ...dto };
      if (dto.start_date) updateData.start_date = new Date(dto.start_date);
      if (dto.end_date) updateData.end_date = new Date(dto.end_date);

      const updateResult = await repo.update(
        { id, tenant_id: tenantId, deleted_at: IsNull() },
        updateData,
      );
      if (updateResult.affected === 0) {
        throw new NotFoundException(`Academic year with ID "${id}" not found`);
      }

      return repo.findOne({
        where: { id, tenant_id: tenantId, deleted_at: IsNull() },
      }) as Promise<AcademicYear>;
    });
  }

  async remove(id: string, tenantId: string): Promise<void> {
    await this.findOne(id, tenantId);
    await this.repo.softDelete({ id, tenant_id: tenantId });
  }

  async setCurrent(id: string, tenantId: string): Promise<AcademicYear> {
    await this.findOne(id, tenantId);

    return this.repo.manager.transaction(async (manager) => {
      const repo = manager.getRepository(AcademicYear);

      // Unset all current years for this tenant
      await repo.update(
        { tenant_id: tenantId, is_current: true, deleted_at: IsNull() },
        { is_current: false },
      );

      // Set this one as current
      await repo.update({ id, tenant_id: tenantId, deleted_at: IsNull() }, { is_current: true });

      return repo.findOne({
        where: { id, tenant_id: tenantId, deleted_at: IsNull() },
      }) as Promise<AcademicYear>;
    });
  }
}