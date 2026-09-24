import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { Routine } from './entities/routine.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { RoutineState } from '@biddaloy/shared';
import { CreateRoutineDto } from './dto/routine-slots.dto';

/** [21.4.1] Routine document CRUD — the timetable container `RoutineSlot`
 * rows hang off. One per `(tenant_id, academic_year_id)` (partial unique
 * index on `deleted_at IS NULL`, see the entity docstring); creating a
 * second draft for a year that already has a live one is refused rather
 * than left to the DB constraint to surface as an opaque 500. */
@Injectable()
export class RoutineService {
  constructor(
    @InjectRepository(Routine)
    private readonly repo: Repository<Routine>,
    @InjectRepository(AcademicYear)
    private readonly academicYearRepo: Repository<AcademicYear>,
  ) {}

  async create(dto: CreateRoutineDto, tenantId: string): Promise<Routine> {
    // The FK only checks `academic_years.id` — without this, a caller
    // could hand in another tenant's academic-year UUID and have it
    // silently accepted (IDOR).
    const academicYear = await this.academicYearRepo.findOne({
      where: { id: dto.academic_year_id, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!academicYear) {
      throw new NotFoundException(`Academic year with ID "${dto.academic_year_id}" not found`);
    }

    const existing = await this.repo.findOne({
      where: { tenant_id: tenantId, academic_year_id: dto.academic_year_id, deleted_at: IsNull() },
    });
    if (existing) {
      throw new ConflictException(
        `A routine already exists for academic year "${dto.academic_year_id}".`,
      );
    }
    const entity = this.repo.create({
      ...dto,
      tenant_id: tenantId,
      state: RoutineState.DRAFT,
      published_at: null,
    });
    return this.repo.save(entity);
  }

  async findAll(tenantId: string): Promise<Routine[]> {
    return this.repo.find({
      where: { tenant_id: tenantId, deleted_at: IsNull() },
      order: { created_at: 'DESC' },
    });
  }

  async findOne(id: string, tenantId: string): Promise<Routine> {
    const routine = await this.repo.findOne({
      where: { id, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!routine) {
      throw new NotFoundException(`Routine with ID "${id}" not found`);
    }
    return routine;
  }
}
