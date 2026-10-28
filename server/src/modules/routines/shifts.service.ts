import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { Shift } from './entities/shift.entity';
import { PeriodSlot } from './entities/period-slot.entity';
import { CreateShiftDto, UpdateShiftDto, QueryShiftDto } from './dto/setup.dto';
import { timeToMinutes } from './period-slots.service';

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
    // Shift row locked for the check + write, the same lock
    // `PeriodSlotsService.replaceForShift` takes: a concurrent period save
    // can't slip a period outside the new window between the two.
    await this.repo.manager.transaction(async (manager) => {
      const shiftRepo = manager.getRepository(Shift);
      const shift = await shiftRepo.findOne({
        where: { id, tenant_id: tenantId, deleted_at: IsNull() },
        lock: { mode: 'pessimistic_write' },
      });
      if (!shift) {
        throw new NotFoundException('Shift not found');
      }

      // The day window may not shrink past the shift's periods.
      if (dto.day_starts_at !== undefined || dto.day_ends_at !== undefined) {
        const starts = timeToMinutes(dto.day_starts_at ?? shift.day_starts_at);
        const ends = timeToMinutes(dto.day_ends_at ?? shift.day_ends_at);
        if (starts >= ends) {
          throw new BadRequestException('The day must end after it starts');
        }
        const periods = await manager.getRepository(PeriodSlot).find({
          where: { shift_id: id, tenant_id: tenantId },
        });
        if (
          periods.some(
            (slot) => timeToMinutes(slot.starts_at) < starts || timeToMinutes(slot.ends_at) > ends,
          )
        ) {
          throw new ConflictException({
            message: 'Some periods fall outside the new day times',
            details: { code: 'SHIFT_PERIODS_OUTSIDE_WINDOW' },
          });
        }
      }

      if (Object.keys(dto).length > 0) {
        await shiftRepo.update({ id, tenant_id: tenantId }, dto);
      }
    });

    return this.findOne(id, tenantId);
  }

  async remove(id: string, tenantId: string): Promise<void> {
    await this.repo.manager.transaction(async (manager) => {
      const shiftRepo = manager.getRepository(Shift);
      const periodSlotRepo = manager.getRepository(PeriodSlot);

      // Lock the shift row before checking references — matches the lock
      // `PeriodSlotsService.replaceForShift` takes, so a concurrent
      // replace can't insert new slots for a shift this call is about to
      // soft-delete (or vice versa).
      const shift = await shiftRepo.findOne({
        where: { id, tenant_id: tenantId, deleted_at: IsNull() },
        lock: { mode: 'pessimistic_write' },
      });
      if (!shift) {
        throw new NotFoundException(`Shift with ID "${id}" not found`);
      }

      // Refuse rather than let `period_slots`' `FK_period_slots_shift ON
      // DELETE CASCADE` silently wipe out a class's whole period structure —
      // the admin must clear the slots first (`PUT .../period-slots` with an
      // empty set is not offered; slots are removed by editing the shift).
      const slotCount = await periodSlotRepo.count({
        where: { shift_id: id, tenant_id: tenantId },
      });
      if (slotCount > 0) {
        throw new ConflictException(
          `Cannot delete shift "${id}": ${slotCount} period slot(s) still reference it. Remove them first.`,
        );
      }

      await shiftRepo.softDelete({ id, tenant_id: tenantId });
    });
  }
}
