import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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
  type EnrollmentInput,
  type ExistingAllocationRoom,
  type RoomInput,
  type ScheduleInput,
  type SectionInput,
} from './allocation';

/**
 * [25.4] Seat plan generation, editing, and publish. Generation delegates
 * its actual allocation math to `./allocation.ts` (#1052's canonical
 * allocation engine).
 */
@Injectable()
export class SeatPlansService {
  constructor(
    @InjectRepository(SeatPlan) private readonly seatPlanRepo: Repository<SeatPlan>,
    @InjectRepository(SeatPlanSchedule)
    private readonly seatPlanScheduleRepo: Repository<SeatPlanSchedule>,
    @InjectRepository(SeatAllocation) private readonly allocationRepo: Repository<SeatAllocation>,
    @InjectRepository(ExamSchedule) private readonly examScheduleRepo: Repository<ExamSchedule>,
    @InjectRepository(Room) private readonly roomRepo: Repository<Room>,
    @InjectRepository(ClassSection) private readonly sectionRepo: Repository<ClassSection>,
    @InjectRepository(Enrollment) private readonly enrollmentRepo: Repository<Enrollment>,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  /** Exam schedules already claimed by a PUBLISHED plan (D6). */
  private async findPublishedClaims(
    tenantId: string,
    examScheduleIds: string[],
  ): Promise<string[]> {
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
   * Roster inputs: every class/section pair covered by the given schedules'
   * classes, plus every ACTIVE enrollment in those classes, plus a
   * class_id -> section list map so each schedule only ever gets its OWN
   * class's sections (not every class in the batch — a `generate` call
   * spanning multiple classes must not leak one class's students onto
   * another class's exam schedule).
   */
  private async buildSections(
    tenantId: string,
    schedules: ExamSchedule[],
  ): Promise<{ enrollments: EnrollmentInput[]; sectionsByClass: Map<string, SectionInput[]> }> {
    const classIds = [...new Set(schedules.map((s) => s.exam.class_id))];
    if (classIds.length === 0) return { enrollments: [], sectionsByClass: new Map() };

    const classSections = await this.sectionRepo.find({
      where: { tenant_id: tenantId, class_id: In(classIds) },
    });
    const enrollmentRows = await this.enrollmentRepo.find({
      where: {
        tenant_id: tenantId,
        class_id: In(classIds),
        enrollment_status: EnrollmentStatus.ACTIVE,
      },
      relations: ['student'],
    });

    const sectionsByClass = new Map<string, SectionInput[]>();
    for (const section of classSections) {
      const list = sectionsByClass.get(section.class_id) ?? [];
      list.push({ class_id: section.class_id, section_id: section.id });
      sectionsByClass.set(section.class_id, list);
    }
    const enrollments: EnrollmentInput[] = enrollmentRows
      .filter((e) => e.section_id)
      .map((e) => ({
        student_id: e.student_id,
        roll_number: e.student.roll_number,
        section_id: e.section_id as string,
        class_id: e.class_id,
        enrollment_status: e.enrollment_status,
      }));
    return { enrollments, sectionsByClass };
  }

  /** Groups a raw published-allocation row set into `ExistingAllocationRoom[]`
   * (one entry per seat_plan_id/room_id, its schedules deduped by id) — the
   * shape `checkRoomConflicts` expects. */
  private groupPublishedAllocations(
    rows: Array<{
      seat_plan_id: string;
      room_id: string;
      exam_schedule_id: string;
      date: string;
      starts_at: string;
      ends_at: string;
    }>,
  ): ExistingAllocationRoom[] {
    const byKey = new Map<string, ExistingAllocationRoom>();
    for (const row of rows) {
      const key = `${row.seat_plan_id}:${row.room_id}`;
      let entry = byKey.get(key);
      if (!entry) {
        entry = { seat_plan_id: row.seat_plan_id, room_id: row.room_id, schedules: [] };
        byKey.set(key, entry);
      }
      if (!entry.schedules.some((s) => s.id === row.exam_schedule_id)) {
        entry.schedules.push({
          id: row.exam_schedule_id,
          date: row.date,
          starts_at: row.starts_at,
          ends_at: row.ends_at,
        });
      }
    }
    return [...byKey.values()];
  }

  private async loadPublishedAllocationsForRooms(
    tenantId: string,
    roomIds: string[],
  ): Promise<ExistingAllocationRoom[]> {
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
    return this.groupPublishedAllocations(rows);
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

    const rooms = await this.roomRepo.find({
      where: { tenant_id: tenantId, id: In(dto.room_ids) },
    });
    if (rooms.length !== dto.room_ids.length) {
      throw new NotFoundException('One or more rooms were not found');
    }
    const roomInputs: RoomInput[] = rooms.map((r) => ({ id: r.id, capacity: r.capacity ?? 0 }));
    const allTenantRooms = await this.roomRepo.find({ where: { tenant_id: tenantId } });
    const allRoomInputs: RoomInput[] = allTenantRooms.map((r) => ({
      id: r.id,
      capacity: r.capacity ?? 0,
    }));

    const { enrollments, sectionsByClass } = await this.buildSections(tenantId, schedules);
    const scheduleInputs = schedules.map((s) => ({
      schedule: {
        id: s.id,
        date: s.date,
        starts_at: s.starts_at,
        ends_at: s.ends_at,
      } satisfies ScheduleInput,
      sections: sectionsByClass.get(s.exam.class_id) ?? [],
    }));
    const roster = computeRoster(scheduleInputs, enrollments);

    const capacity = checkCapacity(roster, roomInputs, allRoomInputs);
    if (!capacity.ok) {
      throw new BadRequestException({
        code: 'SEAT_CAPACITY_SHORTFALL',
        ...capacity,
      });
    }

    const scheduleTimings: ScheduleInput[] = schedules.map((s) => ({
      id: s.id,
      date: s.date,
      starts_at: s.starts_at,
      ends_at: s.ends_at,
    }));
    const existingPublished = await this.loadPublishedAllocationsForRooms(tenantId, dto.room_ids);
    const conflicts = checkRoomConflicts(dto.room_ids, scheduleTimings, existingPublished);

    const { assignments } = allocateSeats(roster, roomInputs, dto.seat_order_mode);

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
    return this.seatPlanRepo.find({
      where: { tenant_id: tenantId },
      order: { created_at: 'DESC' },
    });
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

  async updateAllocation(
    tenantId: string,
    planId: string,
    allocationId: string,
    dto: UpdateAllocationDto,
  ) {
    await this.getDraftPlanOrThrow(tenantId, planId);

    const allocation = await this.allocationRepo.findOne({
      where: { tenant_id: tenantId, seat_plan_id: planId, id: allocationId },
    });
    if (!allocation) throw new NotFoundException('Allocation not found');

    const room = await this.roomRepo.findOne({ where: { tenant_id: tenantId, id: dto.room_id } });
    if (!room) throw new NotFoundException('Room not found');

    const occupied = await this.allocationRepo.count({
      where: {
        tenant_id: tenantId,
        seat_plan_id: planId,
        room_id: dto.room_id,
        exam_schedule_id: allocation.exam_schedule_id,
      },
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

    const allocations = await this.allocationRepo.find({
      where: { tenant_id: tenantId, seat_plan_id: planId },
    });

    // reshuffleRoomAllocation() needs each allocation's section_id/roll_number
    // (D2/D3 — interleave-by-section and order-by-roll survive a reshuffle),
    // neither of which lives on SeatAllocation itself. Join back through the
    // sitting's class to that student's current enrollment for them.
    const rows = allocations.length
      ? await this.allocationRepo
          .createQueryBuilder('a')
          .innerJoin(ExamSchedule, 'es', 'es.id = a.exam_schedule_id')
          .innerJoin('es.exam', 'exam')
          .innerJoin(
            Enrollment,
            'enr',
            'enr.tenant_id = a.tenant_id AND enr.student_id = a.student_id AND enr.class_id = exam.class_id AND enr.enrollment_status = :activeStatus',
            { activeStatus: EnrollmentStatus.ACTIVE },
          )
          .innerJoin('enr.student', 'student')
          .where('a.tenant_id = :tenantId', { tenantId })
          .andWhere('a.seat_plan_id = :planId', { planId })
          .select([
            'a.id AS id',
            'enr.section_id AS section_id',
            'student.roll_number AS roll_number',
          ])
          .getRawMany<{ id: string; section_id: string; roll_number: number }>()
      : [];
    // Only one ACTIVE enrollment per (student, class) can exist (partial unique
    // index on the entity), so `id` is unique here — no last-write-wins risk.
    const enrollmentById = new Map(rows.map((r) => [r.id, r]));

    // A student in the target room whose enrollment no longer matches
    // (dropped, transferred out of the class since generation) has no row
    // here. Don't feed fabricated section/roll data into D2/D3's ordering —
    // hold their seat as-is and reshuffle only the other students in the
    // room; other-room allocations pass through untouched either way (their
    // section/roll is never read for output), so a placeholder is fine there.
    const orphanedInTargetRoom = allocations.filter(
      (a) => a.room_id === roomId && !enrollmentById.has(a.id),
    );
    const reshuffleInput = allocations
      .filter((a) => !orphanedInTargetRoom.includes(a))
      .map((a) => {
        const enrollment = enrollmentById.get(a.id);
        return {
          exam_schedule_id: a.exam_schedule_id,
          student_id: a.student_id,
          section_id: enrollment?.section_id ?? '',
          roll_number: enrollment?.roll_number ?? 0,
          room_id: a.room_id,
          seat_number: a.seat_number,
        };
      });

    const reassigned = reshuffleRoomAllocation(
      reshuffleInput,
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
          (a) =>
            a.room_id === roomId &&
            a.exam_schedule_id === assignment.exam_schedule_id &&
            a.student_id === assignment.student_id,
        );
        if (!existing) continue;
        existing.seat_number = assignment.seat_number;
        await manager.save(SeatAllocation, existing);
      }
      return this.findOne(tenantId, planId);
    });
  }

  async updateInvigilator(
    tenantId: string,
    planId: string,
    roomId: string,
    dto: UpdateInvigilatorDto,
  ) {
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

      const planSchedules = await manager.find(SeatPlanSchedule, {
        where: { tenant_id: tenantId, seat_plan_id: planId },
      });
      const scheduleIds = planSchedules.map((s) => s.exam_schedule_id);
      const schedules = await manager.find(ExamSchedule, {
        where: { tenant_id: tenantId, id: In(scheduleIds) },
      });

      const allocations = await manager.find(SeatAllocation, {
        where: { tenant_id: tenantId, seat_plan_id: planId },
      });
      const roomIds = [...new Set(allocations.map((a) => a.room_id))];

      const scheduleTimings: ScheduleInput[] = schedules.map((s) => ({
        id: s.id,
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

      const conflicts = checkRoomConflicts(
        roomIds,
        scheduleTimings,
        this.groupPublishedAllocations(existingPublished),
      );
      if (conflicts.length > 0) {
        throw new ConflictException({
          message: 'One or more rooms in this plan now conflict with another published plan',
          conflicts,
        });
      }

      plan.status = SeatPlanStatus.PUBLISHED;
      plan.published_at = new Date();
      const publishedPlan = await manager.save(SeatPlan, plan);

      // Not `this.findOne(tenantId, planId)` here: that reads through
      // `this.seatPlanRepo`, a repository outside this transaction's own
      // connection — under READ COMMITTED it would run on a different
      // session than the `save` above and see the pre-commit (still DRAFT)
      // row, handing the caller a stale status right after a successful
      // publish. Build the same `{ ...plan, rooms }` shape from data already
      // fetched on `manager` in this transaction instead.
      const byRoom = new Map<string, SeatAllocation[]>();
      for (const allocation of allocations) {
        const list = byRoom.get(allocation.room_id) ?? [];
        list.push(allocation);
        byRoom.set(allocation.room_id, list);
      }
      return {
        ...publishedPlan,
        rooms: [...byRoom.entries()].map(([room_id, roomAllocations]) => ({
          room_id,
          allocations: roomAllocations,
        })),
      };
    });
  }
}
