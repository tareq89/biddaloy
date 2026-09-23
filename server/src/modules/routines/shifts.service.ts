import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { Shift } from './entities/shift.entity';
import { PeriodSlot } from './entities/period-slot.entity';
import { CreateShiftDto, UpdateShiftDto, QueryShiftDto } from './dto/setup.dto';

/** [21.3.1] Shift CRUD, tenant-scoped — clone of `ClassService`'s pattern
 * in `classes.service.ts` (pagination, soft delete, reference guard on
 * delete). */
@Injectable()
export class ShiftsService {
  constructor(
    @InjectRepository(Shift)
    private readonly repo: Repository<Shift>,
    @InjectRepository(PeriodSlot)
    private readonly periodSlotRepo: Repository<PeriodSlot>,
  ) {}

  async create(dto: CreateShiftDto, tenantId: string): Promise<Shift> {
    const entity = this.repo.create({ ...dto, tenant_id: tenantId });
    return this.repo.save(entity);
  }

  async findAll(
    query: QueryShiftDto,
    tenantId: string,
  ): Promise<{ data: Shift[]; total: number; page: number; limit: number; totalPages: number }> {
    const page = query.page || 1;
    const limit = query.limit || 10;
    const skip = (page - 1) * limit;

    const [data, total] = await this.repo.findAndCount({
      where: { tenant_id: tenantId, deleted_at: IsNull() },
      order: { sequence: 'ASC' },
      skip,
      take: limit,
    });

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string, tenantId: string): Promise<Shift> {
    const shift = await this.repo.findOne({
      where: { id, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!shift) {
      throw new NotFoundException(`Shift with ID "${id}" not found`);
    }
    return shift;
  }

  async update(id: string, dto: UpdateShiftDto, tenantId: string): Promise<Shift> {
    await this.findOne(id, tenantId);

    const changedKeys = Object.keys(dto);
    if (changedKeys.length > 0) {
      await this.repo.update({ id, tenant_id: tenantId }, dto);
    }

    return this.findOne(id, tenantId);
  }

  async remove(id: string, tenantId: string): Promise<void> {
    await this.findOne(id, tenantId);

    // Refuse rather than let `period_slots`' `FK_period_slots_shift ON
    // DELETE CASCADE` silently wipe out a class's whole period structure —
    // the admin must clear the slots first (`PUT .../period-slots` with an
    // empty set is not offered; slots are removed by editing the shift).
    const slotCount = await this.periodSlotRepo.count({
      where: { shift_id: id, tenant_id: tenantId },
    });
    if (slotCount > 0) {
      throw new ConflictException(
        `Cannot delete shift "${id}": ${slotCount} period slot(s) still reference it. Remove them first.`,
      );
    }

    await this.repo.softDelete({ id, tenant_id: tenantId });
  }
}
