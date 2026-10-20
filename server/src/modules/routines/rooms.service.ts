import { assertNoLiveDependents } from '../../common/utils/live-dependents';
import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { Room } from './entities/room.entity';
import { RoutineSlot } from './entities/routine-slot.entity';
import { SeatAllocation } from '../seat-plans/entities/seat-allocation.entity';
import { CreateRoomDto, UpdateRoomDto, QueryRoomDto } from './dto/setup.dto';

/** [21.3.1] Room CRUD, tenant-scoped — same pattern as `ShiftsService`. */
@Injectable()
export class RoomsService {
  constructor(
    @InjectRepository(Room)
    private readonly repo: Repository<Room>,
    @InjectRepository(RoutineSlot)
    private readonly routineSlotRepo: Repository<RoutineSlot>,
  ) {}

  async create(dto: CreateRoomDto, tenantId: string): Promise<Room> {
    const entity = this.repo.create({
      ...dto,
      building: dto.building ?? null,
      capacity: dto.capacity ?? null,
      tenant_id: tenantId,
    });
    return this.repo.save(entity);
  }

  async findAll(
    query: QueryRoomDto,
    tenantId: string,
  ): Promise<{ data: Room[]; total: number; page: number; limit: number; totalPages: number }> {
    const page = query.page || 1;
    const limit = query.limit || 10;
    const skip = (page - 1) * limit;

    const [data, total] = await this.repo.findAndCount({
      where: { tenant_id: tenantId, deleted_at: IsNull() },
      order: { room_no: 'ASC' },
      skip,
      take: limit,
    });

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string, tenantId: string): Promise<Room> {
    const room = await this.repo.findOne({
      where: { id, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!room) {
      throw new NotFoundException(`Room with ID "${id}" not found`);
    }
    return room;
  }

  async update(id: string, dto: UpdateRoomDto, tenantId: string): Promise<Room> {
    await this.findOne(id, tenantId);

    const changedKeys = Object.keys(dto);
    if (changedKeys.length > 0) {
      await this.repo.update({ id, tenant_id: tenantId }, dto);
    }

    return this.findOne(id, tenantId);
  }

  async remove(id: string, tenantId: string): Promise<void> {
    await this.findOne(id, tenantId);

    // `RoutineSlot.room_id` is `ON DELETE SET NULL` at the DB level, but
    // silently un-assigning a room from every scheduled class it's booked
    // into is not a safe default — refuse and name the count, same as
    // `ShiftsService.remove`.
    const referencedCount = await this.routineSlotRepo.count({
      where: { room_id: id, tenant_id: tenantId },
    });
    if (referencedCount > 0) {
      throw new ConflictException(
        `Cannot delete this room: ${referencedCount} routine slot(s) still reference it. Reassign or remove them first.`,
      );
    }

    // [2627] A seat plan (draft or published) that still seats students in this
    // room would render a null room. Soft-deleted plans do not count.
    const allocationCount = await this.repo.manager
      .createQueryBuilder(SeatAllocation, 'a')
      .innerJoin('a.seat_plan', 'p', 'p.deleted_at IS NULL')
      .where('a.room_id = :id AND a.tenant_id = :tenantId', { id, tenantId })
      .getCount();
    if (allocationCount > 0) {
      throw new ConflictException({
        message: `This room is used in ${allocationCount} seat plan allocation(s). Move them first.`,
        details: { code: 'ROOM_IN_USE', seat_allocations_count: allocationCount },
      });
    }

    // [2679] Exam schedules that use the room block the delete too.
    await this.repo.manager.transaction(async (manager) => {
      await assertNoLiveDependents(manager, Room, id, {
        code: 'ROOM_IN_USE',
        message: 'This room is still used by other records. Remove or reassign them first.',
        exclude: ['RoutineSlot.room', 'SeatAllocation.room'],
      });
      await manager.softDelete(Room, { id, tenant_id: tenantId });
    });
  }
}
