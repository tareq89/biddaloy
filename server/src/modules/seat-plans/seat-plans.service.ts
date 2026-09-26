import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { EnrollmentStatus, SeatOrderMode, SeatPlanStatus } from '@biddaloy/shared';
import { SeatPlan } from './entities/seat-plan.entity';
import { SeatPlanSchedule } from './entities/seat-plan-schedule.entity';
import { SeatAllocation } from './entities/seat-allocation.entity';
import { ExamSchedule } from '../exams/entities/exam-schedule.entity';
import { Room } from '../routines/entities/room.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Enrollment } from '../students/entities/enrollment.entity';
import { GenerateSeatPlanDto } from './dto/generate-seat-plan.dto';
import { UpdateAllocationDto, UpdateInvigilatorDto } from './dto/update-allocation.dto';
import {
  allocateSeats,
  checkCapacity,
  checkRoomConflicts,
  computeRoster,
  reshuffleRoom as reshuffleRoomAllocation,
  type ScheduleWithTiming,
  type SectionInput,
} from './allocation';

/**
 * [25.4] Seat plan generation, editing, and publish. Generation delegates
 * its actual allocation math to `./allocation.ts` (a bridging stub here —
 * #1052 owns the canonical version on a parallel branch).
 */
@Injectable()
export class SeatPlansService {
  constructor(
    @InjectRepository(SeatPlan) private readonly seatPlanRepo: Repository<SeatPlan>,
    @InjectRepository(SeatPlanSchedule) private readonly seatPlanScheduleRepo: Repository<SeatPlanSchedule>,
    @InjectRepository(SeatAllocation) private readonly allocationRepo: Repository<SeatAllocation>,
    @InjectRepository(ExamSchedule) private readonly examScheduleRepo: Repository<ExamSchedule>,
    @InjectRepository(Room) private readonly roomRepo: Repository<Room>,
    @InjectRepository(ClassSection) private readonly sectionRepo: Repository<ClassSection>,
    @InjectRepository(Enrollment) private readonly enrollmentRepo: Repository<Enrollment>,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  /** Exam schedules already claimed by a PUBLISHED plan (D6). */
  private async findPublishedClaims(tenantId: string, examScheduleIds: string[]): Promise<string[]> {
    const rows = await this.seatPlanScheduleRepo
      .createQueryBuilder('sps')
      .innerJoin(SeatPlan, 'sp', 'sp.id = sps.seat_plan_id')
      .where('sps.tenant_id = :tenantId', { tenantId })
      .andWhere('sps.exam_schedule_id IN (:...ids)', { ids: examScheduleIds })
      .andWhere('sp.status = :status', { status: SeatPlanStatus.PUBLISHED })
      .select('sps.exam_schedule_id', 'exam_schedule_id')
      .getRawMany<{ exam_schedule_id: string }>();
    return rows.map((r) => r.exam_schedule_id);
  }

  /**
   * Roster inputs: sections (with active-enrolled students) per class covered
   * by the given schedules, plus a class_id -> section_ids map so each
   * schedule only ever gets its OWN class's sections (not every class in the
   * batch — a `generate` call spanning multiple classes must not leak one
   * class's students onto another class's exam schedule).
   */
  private async buildSections(
    tenantId: string,
    schedules: ExamSchedule[],
  ): Promise<{ sections: SectionInput[]; sectionIdsByClass: Map<string, string[]> }> {
    const classIds = [...new Set(schedules.map((s) => s.exam.class_id))];
    if (classIds.length === 0) return { sections: [], sectionIdsByClass: new Map() };

    const classSections = await this.sectionRepo.find({ where: { tenant_id: tenantId, class_id: In(classIds) } });
    const enrollments = await this.enrollmentRepo.find({
      where: { tenant_id: tenantId, class_id: In(classIds), enrollment_status: EnrollmentStatus.ACTIVE },
      relations: ['student'],
    });

    const bySection = new Map<string, SectionInput>();
    const sectionIdsByClass = new Map<string, string[]>();
    for (const section of classSections) {
      bySection.set(section.id, { id: section.id, students: [] });
      const list = sectionIdsByClass.get(section.class_id) ?? [];
      list.push(section.id);
      sectionIdsByClass.set(section.class_id, list);
    }
    for (const enrollment of enrollments) {
      if (!enrollment.section_id) continue;
      const section = bySection.get(enrollment.section_id);
      if (!section) continue;
      section.students.push({
        id: enrollment.student.id,
        roll_number: enrollment.student.roll_number,
        section_id: enrollment.section_id,
      });
    }
    return { sections: [...bySection.values()], sectionIdsByClass };
  }

  private async loadPublishedAllocationsForRooms(tenantId: string, roomIds: string[]) {
    if (roomIds.length === 0) return [];
    const rows = await this.allocationRepo
      .createQueryBuilder('a')
      .innerJoin(SeatPlan, 'sp', 'sp.id = a.seat_plan_id')
      .innerJoin(ExamSchedule, 'es', 'es.id = a.exam_schedule_id')
      .where('a.tenant_id = :tenantId', { tenantId })
      .andWhere('a.room_id IN (:...roomIds)', { roomIds })
      .andWhere('sp.status = :status', { status: SeatPlanStatus.PUBLISHED })
      .select([
        'sp.id AS seat_plan_id',
        'a.room_id AS room_id',
        'a.exam_schedule_id AS exam_schedule_id',
        'es.date AS date',
        'es.starts_at AS starts_at',
        'es.ends_at AS ends_at',
      ])
      .getRawMany<{
        seat_plan_id: string;
        room_id: string;
        exam_schedule_id: string;
        date: string;
        starts_at: string;
        ends_at: string;
      }>();
    return rows;
  }

  async generate(tenantId: string, dto: GenerateSeatPlanDto) {
    const alreadyClaimed = await this.findPublishedClaims(tenantId, dto.exam_schedule_ids);
    if (alreadyClaimed.length > 0) {
      throw new ConflictException({
        message: 'One or more exam schedules are already part of a published seat plan',
        exam_schedule_ids: alreadyClaimed,
      });
    }

    const schedules = await this.examScheduleRepo.find({
      where: { tenant_id: tenantId, id: In(dto.exam_schedule_ids) },
      relations: ['exam'],
    });
    if (schedules.length !== dto.exam_schedule_ids.length) {
      throw new NotFoundException('One or more exam schedules were not found');
    }

    const rooms = await this.roomRepo.find({ where: { tenant_id: tenantId, id: In(dto.room_ids) } });
    if (rooms.length !== dto.room_ids.length) {
      throw new NotFoundException('One or more rooms were not found');
    }
    const roomInputs = rooms.map((r) => ({ id: r.id, capacity: r.capacity ?? 0 }));

    const { sections, sectionIdsByClass } = await this.buildSections(tenantId, schedules);
    const scheduleInputs = schedules.map((s) => ({
      id: s.id,
      section_ids: sectionIdsByClass.get(s.exam.class_id) ?? [],
    }));
    const roster = computeRoster(scheduleInputs, sections);

    const capacity = checkCapacity(roster, roomInputs);
    if (!capacity.ok) {
      throw new BadRequestException({
        code: 'SEAT_CAPACITY_SHORTFALL',
        ...capacity,
      });
    }

    const scheduleTimings: ScheduleWithTiming[] = schedules.map((s) => ({
      id: s.id,
      section_ids: [],
      date: s.date,
      starts_at: s.starts_at,
      ends_at: s.ends_at,
    }));
    const existingPublished = await this.loadPublishedAllocationsForRooms(tenantId, dto.room_ids);
    const conflicts = checkRoomConflicts(roomInputs, scheduleTimings, existingPublished);

    const assignments = allocateSeats(roster, roomInputs, dto.seat_order_mode);

    const created = await this.dataSource.transaction(async (manager: EntityManager) => {
      const plan = await manager.save(SeatPlan, {
        tenant_id: tenantId,
        name: dto.name,
        status: SeatPlanStatus.DRAFT,
        seat_order_mode: dto.seat_order_mode,
      });

      await manager.save(
        SeatPlanSchedule,
        schedules.map((s) => ({
          tenant_id: tenantId,
          seat_plan_id: plan.id,
          exam_schedule_id: s.id,
        })),
      );

      await manager.save(
        SeatAllocation,
        assignments.map((a) => ({
          tenant_id: tenantId,
          seat_plan_id: plan.id,
          exam_schedule_id: a.exam_schedule_id,
          student_id: a.student_id,
          room_id: a.room_id,
          seat_number: a.seat_number,
        })),
      );

      return plan;
    });

    return { plan: await this.findOne(tenantId, created.id), conflicts };
  }

  async findAll(tenantId: string) {
    return this.seatPlanRepo.find({ where: { tenant_id: tenantId }, order: { created_at: 'DESC' } });
  }

  async findOne(tenantId: string, id: string) {
    const plan = await this.seatPlanRepo.findOne({ where: { tenant_id: tenantId, id } });
    if (!plan) throw new NotFoundException('Seat plan not found');

    const allocations = await this.allocationRepo.find({
      where: { tenant_id: tenantId, seat_plan_id: id },
      order: { room_id: 'ASC', seat_number: 'ASC' },
    });
    const byRoom = new Map<string, SeatAllocation[]>();
    for (const allocation of allocations) {
      const list = byRoom.get(allocation.room_id) ?? [];
      list.push(allocation);
      byRoom.set(allocation.room_id, list);
    }

    return {
      ...plan,
      rooms: [...byRoom.entries()].map(([room_id, roomAllocations]) => ({
        room_id,
        allocations: roomAllocations,
      })),
    };
  }

  private async getDraftPlanOrThrow(tenantId: string, planId: string): Promise<SeatPlan> {
    const plan = await this.seatPlanRepo.findOne({ where: { tenant_id: tenantId, id: planId } });
    if (!plan) throw new NotFoundException('Seat plan not found');
    if (plan.status !== SeatPlanStatus.DRAFT) {
      throw new ConflictException('Seat plan is no longer a draft and cannot be modified');
    }
    return plan;
  }

  async updateAllocation(tenantId: string, planId: string, allocationId: string, dto: UpdateAllocationDto) {
    await this.getDraftPlanOrThrow(tenantId, planId);

    const allocation = await this.allocationRepo.findOne({
      where: { tenant_id: tenantId, seat_plan_id: planId, id: allocationId },
    });
    if (!allocation) throw new NotFoundException('Allocation not found');

    const room = await this.roomRepo.findOne({ where: { tenant_id: tenantId, id: dto.room_id } });
    if (!room) throw new NotFoundException('Room not found');

    const occupied = await this.allocationRepo.count({
      where: { tenant_id: tenantId, seat_plan_id: planId, room_id: dto.room_id, exam_schedule_id: allocation.exam_schedule_id },
    });
    const capacity = room.capacity ?? 0;
    const movingWithinSameRoom = allocation.room_id === dto.room_id;
    const effectiveOccupied = movingWithinSameRoom ? occupied - 1 : occupied;
    if (effectiveOccupied >= capacity) {
      throw new BadRequestException({
        code: 'SEAT_CAPACITY_SHORTFALL',
        message: 'Target room has no free capacity for this subject sitting',
        room_id: dto.room_id,
      });
    }

    const seatTaken = await this.allocationRepo.findOne({
      where: {
        tenant_id: tenantId,
        seat_plan_id: planId,
        room_id: dto.room_id,
        seat_number: dto.seat_number,
        exam_schedule_id: allocation.exam_schedule_id,
      },
    });
    if (seatTaken && seatTaken.id !== allocationId) {
      throw new ConflictException({
        code: 'SEAT_ALREADY_TAKEN',
        message: 'That seat in the target room is already assigned to another student',
        room_id: dto.room_id,
        seat_number: dto.seat_number,
      });
    }

    allocation.room_id = dto.room_id;
    allocation.seat_number = dto.seat_number;
    return this.allocationRepo.save(allocation);
  }

  async reshuffleRoom(tenantId: string, planId: string, roomId: string, orderMode?: SeatOrderMode) {
    const plan = await this.getDraftPlanOrThrow(tenantId, planId);

    const allocations = await this.allocationRepo.find({ where: { tenant_id: tenantId, seat_plan_id: planId } });
    const reassigned = reshuffleRoomAllocation(
      allocations.map((a) => ({
        exam_schedule_id: a.exam_schedule_id,
        student_id: a.student_id,
        room_id: a.room_id,
        seat_number: a.seat_number,
      })),
      roomId,
      orderMode ?? plan.seat_order_mode,
    );

    // reshuffleRoomAllocation() only ever reassigns seats within `roomId`
    // (that's the whole point — other rooms are untouched), so matching
    // back by (exam_schedule_id, student_id) among that room's own rows is enough.
    return this.dataSource.transaction(async (manager) => {
      for (const assignment of reassigned) {
        if (assignment.room_id !== roomId) continue;
        const existing = allocations.find(
          (a) => a.room_id === roomId && a.exam_schedule_id === assignment.exam_schedule_id && a.student_id === assignment.student_id,
        );
        if (!existing) continue;
        existing.seat_number = assignment.seat_number;
        await manager.save(SeatAllocation, existing);
      }
      return this.findOne(tenantId, planId);
    });
  }

  async updateInvigilator(tenantId: string, planId: string, roomId: string, dto: UpdateInvigilatorDto) {
    await this.seatPlanRepo.findOne({ where: { tenant_id: tenantId, id: planId } }).then((plan) => {
      if (!plan) throw new NotFoundException('Seat plan not found');
    });

    await this.allocationRepo.update(
      { tenant_id: tenantId, seat_plan_id: planId, room_id: roomId },
      { invigilator_user_id: dto.invigilator_user_id },
    );
    return this.findOne(tenantId, planId);
  }

  async publish(tenantId: string, planId: string) {
    return this.dataSource.transaction(async (manager) => {
      const plan = await manager.findOne(SeatPlan, { where: { tenant_id: tenantId, id: planId } });
      if (!plan) throw new NotFoundException('Seat plan not found');
      if (plan.status !== SeatPlanStatus.DRAFT) {
        throw new ConflictException('Seat plan is already published');
      }

      const planSchedules = await manager.find(SeatPlanSchedule, { where: { tenant_id: tenantId, seat_plan_id: planId } });
      const scheduleIds = planSchedules.map((s) => s.exam_schedule_id);
      const schedules = await manager.find(ExamSchedule, { where: { tenant_id: tenantId, id: In(scheduleIds) } });

      const allocations = await manager.find(SeatAllocation, { where: { tenant_id: tenantId, seat_plan_id: planId } });
      const roomIds = [...new Set(allocations.map((a) => a.room_id))];
      const rooms = await manager.find(Room, { where: { tenant_id: tenantId, id: In(roomIds) } });
      const roomInputs = rooms.map((r) => ({ id: r.id, capacity: r.capacity ?? 0 }));

      const scheduleTimings: ScheduleWithTiming[] = schedules.map((s) => ({
        id: s.id,
        section_ids: [],
        date: s.date,
        starts_at: s.starts_at,
        ends_at: s.ends_at,
      }));

      const existingPublished = await manager
        .createQueryBuilder(SeatAllocation, 'a')
        .innerJoin(SeatPlan, 'sp', 'sp.id = a.seat_plan_id')
        .innerJoin(ExamSchedule, 'es', 'es.id = a.exam_schedule_id')
        .where('a.tenant_id = :tenantId', { tenantId })
        .andWhere('a.room_id IN (:...roomIds)', { roomIds: roomIds.length ? roomIds : [''] })
        .andWhere('sp.status = :status', { status: SeatPlanStatus.PUBLISHED })
        .andWhere('sp.id != :planId', { planId })
        .select([
          'sp.id AS seat_plan_id',
          'a.room_id AS room_id',
          'a.exam_schedule_id AS exam_schedule_id',
          'es.date AS date',
          'es.starts_at AS starts_at',
          'es.ends_at AS ends_at',
        ])
        .getRawMany<{
          seat_plan_id: string;
          room_id: string;
          exam_schedule_id: string;
          date: string;
          starts_at: string;
          ends_at: string;
        }>();

      const conflicts = checkRoomConflicts(roomInputs, scheduleTimings, existingPublished);
      if (conflicts.length > 0) {
        throw new ConflictException({
          message: 'One or more rooms in this plan now conflict with another published plan',
          conflicts,
        });
      }

      plan.status = SeatPlanStatus.PUBLISHED;
      plan.published_at = new Date();
      await manager.save(SeatPlan, plan);
      return this.findOne(tenantId, planId);
    });
  }
}
