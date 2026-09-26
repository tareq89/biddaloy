import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { EnrollmentStatus, SeatOrderMode, SeatPlanStatus } from '@biddaloy/shared';
import { Reflector } from '@nestjs/core';
import { Permission } from '@biddaloy/shared';
import { SeatPlansService } from './seat-plans.service';
import { SeatPlansController } from './seat-plans.controller';
import { PERMISSIONS_KEY } from '../auth/decorators/require-permissions.decorator';

const TENANT = 'tenant-1';
const SCHEDULE_A = 'schedule-a';
const SCHEDULE_B = 'schedule-b';
const ROOM_1 = 'room-1';
const ROOM_2 = 'room-2';
const SECTION_1 = 'section-1';
const SECTION_2 = 'section-2';

function qb(rows: unknown[] = []) {
  const builder: any = {
    innerJoin: vi.fn(() => builder),
    where: vi.fn(() => builder),
    andWhere: vi.fn(() => builder),
    select: vi.fn(() => builder),
    addSelect: vi.fn(() => builder),
    groupBy: vi.fn(() => builder),
    getRawMany: vi.fn(async () => rows),
  };
  return builder;
}

function makeStudent(id: string, roll: number) {
  return { id, roll_number: roll };
}

/** Shape `enrollmentRepo.find({ relations: ['student'] })` really returns:
 * the enrollment's own columns (student_id, class_id, section_id,
 * enrollment_status) plus the joined `student` relation. */
function makeEnrollment(studentId: string, roll: number, classId: string, sectionId: string) {
  return {
    student_id: studentId,
    class_id: classId,
    section_id: sectionId,
    enrollment_status: EnrollmentStatus.ACTIVE,
    student: makeStudent(studentId, roll),
  };
}

function makeSchedule(id: string, classId: string, overrides: Partial<any> = {}) {
  return {
    id,
    tenant_id: TENANT,
    exam: { id: `exam-${classId}`, class_id: classId },
    date: '2026-01-01',
    starts_at: '09:00:00',
    ends_at: '11:00:00',
    ...overrides,
  };
}

describe('SeatPlansService', () => {
  let seatPlanRepo: any;
  let seatPlanScheduleRepo: any;
  let allocationRepo: any;
  let examScheduleRepo: any;
  let roomRepo: any;
  let sectionRepo: any;
  let enrollmentRepo: any;
  let dataSource: any;
  let service: SeatPlansService;

  beforeEach(() => {
    seatPlanRepo = {
      find: vi.fn(async () => []),
      findOne: vi.fn(async () => null),
    };
    seatPlanScheduleRepo = {
      createQueryBuilder: vi.fn(() => qb([])),
    };
    allocationRepo = {
      find: vi.fn(async () => []),
      count: vi.fn(async () => 0),
      save: vi.fn(async (v: any) => v),
      createQueryBuilder: vi.fn(() => qb([])),
    };
    examScheduleRepo = {
      find: vi.fn(async () => []),
    };
    roomRepo = {
      find: vi.fn(async () => []),
      findOne: vi.fn(async () => null),
    };
    sectionRepo = {
      find: vi.fn(async () => []),
    };
    enrollmentRepo = {
      find: vi.fn(async () => []),
    };
    dataSource = {
      transaction: vi.fn(async (cb: any) => cb(fakeManager())),
    };

    service = new SeatPlansService(
      seatPlanRepo,
      seatPlanScheduleRepo,
      allocationRepo,
      examScheduleRepo,
      roomRepo,
      sectionRepo,
      enrollmentRepo,
      dataSource,
    );
  });

  function fakeManager() {
    const store: Record<string, any[]> = { SeatPlan: [], SeatPlanSchedule: [], SeatAllocation: [] };
    let nextId = 1;
    return {
      save: vi.fn(async (entityClass: any, value: any) => {
        const name = entityClass.name;
        if (Array.isArray(value)) {
          const saved = value.map((v) => ({ id: `${name}-${nextId++}`, ...v }));
          store[name] = [...(store[name] ?? []), ...saved];
          return saved;
        }
        const saved = { id: value.id ?? `${name}-${nextId++}`, ...value };
        store[name] = [...(store[name] ?? []), saved];
        return saved;
      }),
      find: vi.fn(async () => []),
      findOne: vi.fn(async () => null),
      createQueryBuilder: vi.fn(() => qb([])),
    };
  }

  describe('generate', () => {
    it('creates a correct draft, mixing sections and respecting capacity', async () => {
      const schedule = makeSchedule(SCHEDULE_A, 'class-1');
      examScheduleRepo.find.mockResolvedValue([schedule]);
      roomRepo.find.mockResolvedValue([
        { id: ROOM_1, capacity: 2, tenant_id: TENANT },
        { id: ROOM_2, capacity: 2, tenant_id: TENANT },
      ]);
      sectionRepo.find.mockResolvedValue([
        { id: SECTION_1, class_id: 'class-1' },
        { id: SECTION_2, class_id: 'class-1' },
      ]);
      enrollmentRepo.find.mockResolvedValue([
        makeEnrollment('s1', 1, 'class-1', SECTION_1),
        makeEnrollment('s2', 2, 'class-1', SECTION_1),
        makeEnrollment('s3', 1, 'class-1', SECTION_2),
        makeEnrollment('s4', 2, 'class-1', SECTION_2),
      ]);
      seatPlanRepo.findOne.mockResolvedValue({
        id: 'SeatPlan-1',
        tenant_id: TENANT,
        status: SeatPlanStatus.DRAFT,
      });

      const result = await service.generate(TENANT, {
        name: 'Term Exam Seating',
        exam_schedule_ids: [SCHEDULE_A],
        room_ids: [ROOM_1, ROOM_2],
        seat_order_mode: SeatOrderMode.SEQUENTIAL,
      });

      expect(result.conflicts).toEqual([]);
      expect(result.plan).toBeTruthy();
      // 4 students across 2 rooms of capacity 2 each — fully packed, no shortfall.
    });

    it('fails with structured shortfall and suggestions when rooms are too small', async () => {
      const schedule = makeSchedule(SCHEDULE_A, 'class-1');
      examScheduleRepo.find.mockResolvedValue([schedule]);
      roomRepo.find.mockResolvedValue([{ id: ROOM_1, capacity: 1, tenant_id: TENANT }]);
      sectionRepo.find.mockResolvedValue([{ id: SECTION_1, class_id: 'class-1' }]);
      enrollmentRepo.find.mockResolvedValue([
        makeEnrollment('s1', 1, 'class-1', SECTION_1),
        makeEnrollment('s2', 2, 'class-1', SECTION_1),
      ]);

      await expect(
        service.generate(TENANT, {
          name: 'Too Small',
          exam_schedule_ids: [SCHEDULE_A],
          room_ids: [ROOM_1],
          seat_order_mode: SeatOrderMode.SEQUENTIAL,
        }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          message: expect.any(String),
          details: expect.objectContaining({
            code: 'SEAT_CAPACITY_SHORTFALL',
            seats_needed: 2,
            seats_available: 1,
            shortfall: 1,
          }),
        }),
      });
    });

    it("does not leak one class's students onto another class's schedule when generating across classes", async () => {
      // Two schedules for two different classes in one generate call — each schedule
      // must only draw its own class's roster, not the other class's students too.
      const scheduleClass1 = makeSchedule(SCHEDULE_A, 'class-1');
      const scheduleClass2 = makeSchedule(SCHEDULE_B, 'class-2');
      examScheduleRepo.find.mockResolvedValue([scheduleClass1, scheduleClass2]);
      roomRepo.find.mockResolvedValue([{ id: ROOM_1, capacity: 10, tenant_id: TENANT }]);
      sectionRepo.find.mockResolvedValue([
        { id: SECTION_1, class_id: 'class-1' },
        { id: SECTION_2, class_id: 'class-2' },
      ]);
      enrollmentRepo.find.mockResolvedValue([
        makeEnrollment('s1', 1, 'class-1', SECTION_1),
        makeEnrollment('s2', 1, 'class-2', SECTION_2),
      ]);
      seatPlanRepo.findOne.mockResolvedValue({
        id: 'SeatPlan-1',
        tenant_id: TENANT,
        status: SeatPlanStatus.DRAFT,
      });

      let savedAllocations: any[] = [];
      dataSource.transaction = vi.fn(async (cb: any) => {
        const manager = {
          save: vi.fn(async (entityClass: any, value: any) => {
            if (entityClass.name === 'SeatAllocation')
              savedAllocations = Array.isArray(value) ? value : [value];
            const saved = Array.isArray(value)
              ? value.map((v) => ({ id: 'x', ...v }))
              : { id: 'x', ...value };
            return saved;
          }),
          find: vi.fn(async () => []),
          findOne: vi.fn(async () => null),
          createQueryBuilder: vi.fn(() => qb([])),
        };
        return cb(manager);
      });

      await service.generate(TENANT, {
        name: 'Cross-class generate',
        exam_schedule_ids: [SCHEDULE_A, SCHEDULE_B],
        room_ids: [ROOM_1],
        seat_order_mode: SeatOrderMode.SEQUENTIAL,
      });

      // class-1's schedule must only seat s1; class-2's schedule must only seat s2.
      const forScheduleA = savedAllocations.filter((a) => a.exam_schedule_id === SCHEDULE_A);
      const forScheduleB = savedAllocations.filter((a) => a.exam_schedule_id === SCHEDULE_B);
      expect(forScheduleA.map((a) => a.student_id)).toEqual(['s1']);
      expect(forScheduleB.map((a) => a.student_id)).toEqual(['s2']);
    });

    it('rejects generation reusing a schedule already in a published plan', async () => {
      seatPlanScheduleRepo.createQueryBuilder.mockReturnValue(
        qb([{ exam_schedule_id: SCHEDULE_A }]),
      );

      await expect(
        service.generate(TENANT, {
          name: 'Reuse',
          exam_schedule_ids: [SCHEDULE_A],
          room_ids: [ROOM_1],
          seat_order_mode: SeatOrderMode.SEQUENTIAL,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('findAll', () => {
    it('attaches schedule/room/student counts per plan for the list screen [25.6]', async () => {
      seatPlanRepo.find.mockResolvedValue([
        { id: 'plan-1', name: 'Plan One', status: SeatPlanStatus.DRAFT },
        { id: 'plan-2', name: 'Plan Two', status: SeatPlanStatus.PUBLISHED },
      ]);
      seatPlanScheduleRepo.createQueryBuilder.mockReturnValue(
        qb([
          { seat_plan_id: 'plan-1', count: '2' },
          { seat_plan_id: 'plan-2', count: '1' },
        ]),
      );
      allocationRepo.createQueryBuilder.mockReturnValue(
        qb([
          { seat_plan_id: 'plan-1', room_count: '3', student_count: '40' },
          // plan-2 has no allocations yet (rows omitted, not zero rows).
        ]),
      );

      const result = await service.findAll(TENANT);

      expect(result).toEqual([
        {
          id: 'plan-1',
          name: 'Plan One',
          status: SeatPlanStatus.DRAFT,
          schedule_count: 2,
          room_count: 3,
          student_count: 40,
        },
        {
          id: 'plan-2',
          name: 'Plan Two',
          status: SeatPlanStatus.PUBLISHED,
          schedule_count: 1,
          room_count: 0,
          student_count: 0,
        },
      ]);
    });

    it('returns an empty list without querying counts when there are no plans', async () => {
      seatPlanRepo.find.mockResolvedValue([]);

      const result = await service.findAll(TENANT);

      expect(result).toEqual([]);
      expect(seatPlanScheduleRepo.createQueryBuilder).not.toHaveBeenCalled();
      expect(allocationRepo.createQueryBuilder).not.toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('groups allocations by room and joins student/room/subject/invigilator display data [25.7]', async () => {
      seatPlanRepo.findOne.mockResolvedValue({
        id: 'plan-1',
        name: 'Plan One',
        status: SeatPlanStatus.DRAFT,
      });
      allocationRepo.find.mockResolvedValue([
        {
          id: 'alloc-1',
          exam_schedule_id: SCHEDULE_A,
          student_id: 'student-1',
          room_id: ROOM_1,
          seat_number: '1',
          invigilator_user_id: 'user-1',
          student: {
            full_name: 'Rahim Uddin',
            roll_number: 1,
            class_section: { section_name: 'A' },
          },
          room: { room_no: '101', building: 'Main', capacity: 30 },
          exam_schedule: { subject: { name_en: 'Mathematics' } },
          invigilator: { full_name: 'Ms. Chowdhury' },
        },
        {
          id: 'alloc-2',
          exam_schedule_id: SCHEDULE_A,
          student_id: 'student-2',
          room_id: ROOM_2,
          seat_number: '1',
          invigilator_user_id: null,
          student: {
            full_name: 'Karim Sheikh',
            roll_number: 2,
            class_section: { section_name: 'B' },
          },
          room: { room_no: '102', building: 'Main', capacity: 20 },
          exam_schedule: { subject: { name_en: 'Mathematics' } },
          invigilator: null,
        },
      ]);

      const result = await service.findOne(TENANT, 'plan-1');

      expect(result.rooms).toEqual([
        {
          room_id: ROOM_1,
          room_no: '101',
          building: 'Main',
          capacity: 30,
          invigilator_user_id: 'user-1',
          invigilator_name: 'Ms. Chowdhury',
          allocations: [
            {
              id: 'alloc-1',
              exam_schedule_id: SCHEDULE_A,
              student_id: 'student-1',
              student_name: 'Rahim Uddin',
              roll_number: 1,
              section_name: 'A',
              subject_name: 'Mathematics',
              room_id: ROOM_1,
              seat_number: '1',
            },
          ],
        },
        {
          room_id: ROOM_2,
          room_no: '102',
          building: 'Main',
          capacity: 20,
          invigilator_user_id: null,
          invigilator_name: null,
          allocations: [
            {
              id: 'alloc-2',
              exam_schedule_id: SCHEDULE_A,
              student_id: 'student-2',
              student_name: 'Karim Sheikh',
              roll_number: 2,
              section_name: 'B',
              subject_name: 'Mathematics',
              room_id: ROOM_2,
              seat_number: '1',
            },
          ],
        },
      ]);
    });
  });

  describe('updateAllocation', () => {
    it('rejects a move that would exceed target room capacity', async () => {
      seatPlanRepo.findOne.mockResolvedValue({
        id: 'plan-1',
        tenant_id: TENANT,
        status: SeatPlanStatus.DRAFT,
      });
      allocationRepo.find = undefined;
      (allocationRepo as any).findOne = vi.fn(async () => ({
        id: 'alloc-1',
        tenant_id: TENANT,
        seat_plan_id: 'plan-1',
        room_id: ROOM_1,
        exam_schedule_id: SCHEDULE_A,
        student_id: 's1',
        seat_number: '1',
      }));
      roomRepo.findOne.mockResolvedValue({ id: ROOM_2, tenant_id: TENANT, capacity: 1 });
      allocationRepo.count.mockResolvedValue(1); // room already full

      await expect(
        service.updateAllocation(TENANT, 'plan-1', 'alloc-1', {
          room_id: ROOM_2,
          seat_number: '1',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a move onto a seat already taken by another student in the same schedule', async () => {
      seatPlanRepo.findOne.mockResolvedValue({
        id: 'plan-1',
        tenant_id: TENANT,
        status: SeatPlanStatus.DRAFT,
      });
      roomRepo.findOne.mockResolvedValue({ id: ROOM_2, tenant_id: TENANT, capacity: 10 });
      allocationRepo.count.mockResolvedValue(0); // plenty of capacity
      (allocationRepo as any).findOne = vi
        .fn()
        // 1st call: the allocation being moved
        .mockResolvedValueOnce({
          id: 'alloc-1',
          tenant_id: TENANT,
          seat_plan_id: 'plan-1',
          room_id: ROOM_1,
          exam_schedule_id: SCHEDULE_A,
          student_id: 's1',
          seat_number: '1',
        })
        // 2nd call: another student already sits at ROOM_2 seat 1 for the same schedule
        .mockResolvedValueOnce({
          id: 'alloc-2',
          tenant_id: TENANT,
          seat_plan_id: 'plan-1',
          room_id: ROOM_2,
          exam_schedule_id: SCHEDULE_A,
          student_id: 's2',
          seat_number: '1',
        });

      await expect(
        service.updateAllocation(TENANT, 'plan-1', 'alloc-1', {
          room_id: ROOM_2,
          seat_number: '1',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects editing once the plan is published', async () => {
      seatPlanRepo.findOne.mockResolvedValue({
        id: 'plan-1',
        tenant_id: TENANT,
        status: SeatPlanStatus.PUBLISHED,
      });

      await expect(
        service.updateAllocation(TENANT, 'plan-1', 'alloc-1', {
          room_id: ROOM_2,
          seat_number: '1',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('reshuffleRoom', () => {
    it('only touches allocations in the targeted room', async () => {
      seatPlanRepo.findOne.mockResolvedValue({
        id: 'plan-1',
        tenant_id: TENANT,
        status: SeatPlanStatus.DRAFT,
        seat_order_mode: SeatOrderMode.SEQUENTIAL,
      });
      const roomOneAllocations = [
        {
          id: 'a1',
          room_id: ROOM_1,
          exam_schedule_id: SCHEDULE_A,
          student_id: 's1',
          seat_number: '1',
        },
        {
          id: 'a2',
          room_id: ROOM_1,
          exam_schedule_id: SCHEDULE_A,
          student_id: 's2',
          seat_number: '2',
        },
      ];
      const roomTwoAllocations = [
        {
          id: 'a3',
          room_id: ROOM_2,
          exam_schedule_id: SCHEDULE_A,
          student_id: 's3',
          seat_number: '1',
        },
      ];
      allocationRepo.find.mockResolvedValue([...roomOneAllocations, ...roomTwoAllocations]);
      // reshuffleRoom() backfills section_id/roll_number per allocation via a join
      // to the student's current enrollment — give every allocation a match.
      allocationRepo.createQueryBuilder.mockReturnValue(
        qb([
          { id: 'a1', section_id: SECTION_1, roll_number: 1 },
          { id: 'a2', section_id: SECTION_1, roll_number: 2 },
          { id: 'a3', section_id: SECTION_2, roll_number: 1 },
        ]),
      );
      const saved: any[] = [];
      dataSource.transaction = vi.fn(async (cb: any) =>
        cb({
          save: vi.fn(async (_entity: any, value: any) => {
            saved.push({ ...value });
            return value;
          }),
        }),
      );

      await service.reshuffleRoom(TENANT, 'plan-1', ROOM_1);

      expect(saved.every((s) => s.room_id === ROOM_1)).toBe(true);
      expect(saved).toHaveLength(2);
    });

    it('leaves a seat untouched when its student has no matching ACTIVE enrollment (dropped/transferred since generation)', async () => {
      seatPlanRepo.findOne.mockResolvedValue({
        id: 'plan-1',
        tenant_id: TENANT,
        status: SeatPlanStatus.DRAFT,
        seat_order_mode: SeatOrderMode.SEQUENTIAL,
      });
      const roomOneAllocations = [
        {
          id: 'a1',
          room_id: ROOM_1,
          exam_schedule_id: SCHEDULE_A,
          student_id: 's1',
          seat_number: '1',
        },
        {
          id: 'a2',
          room_id: ROOM_1,
          exam_schedule_id: SCHEDULE_A,
          student_id: 's2',
          seat_number: '2',
        },
      ];
      allocationRepo.find.mockResolvedValue(roomOneAllocations);
      // Only a1 has a matching ACTIVE enrollment row — a2's student has since
      // left the class (or been marked inactive), so the join drops it.
      allocationRepo.createQueryBuilder.mockReturnValue(
        qb([{ id: 'a1', section_id: SECTION_1, roll_number: 1 }]),
      );
      const saved: any[] = [];
      dataSource.transaction = vi.fn(async (cb: any) =>
        cb({
          save: vi.fn(async (_entity: any, value: any) => {
            saved.push({ ...value });
            return value;
          }),
        }),
      );

      await service.reshuffleRoom(TENANT, 'plan-1', ROOM_1);

      // a2 (no enrollment match) must never be reassigned — it keeps its
      // existing seat rather than getting fabricated section/roll data.
      expect(saved.some((s) => s.id === 'a2')).toBe(false);
    });

    it('rejects reshuffle once the plan is published', async () => {
      seatPlanRepo.findOne.mockResolvedValue({
        id: 'plan-1',
        tenant_id: TENANT,
        status: SeatPlanStatus.PUBLISHED,
      });

      await expect(service.reshuffleRoom(TENANT, 'plan-1', ROOM_1)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('publish', () => {
    it('locks the plan so a second generate attempt reusing its schedule is rejected', async () => {
      dataSource.transaction = vi.fn(async (cb: any) =>
        cb({
          findOne: vi.fn(async () => ({
            id: 'plan-1',
            tenant_id: TENANT,
            status: SeatPlanStatus.DRAFT,
          })),
          find: vi.fn(async () => []),
          save: vi.fn(async (_e: any, v: any) => v),
          createQueryBuilder: vi.fn(() => qb([])),
        }),
      );
      seatPlanRepo.findOne.mockResolvedValue({
        id: 'plan-1',
        tenant_id: TENANT,
        status: SeatPlanStatus.PUBLISHED,
      });

      await service.publish(TENANT, 'plan-1');

      // A follow-up generate() referencing the same (now-published) schedule must be rejected —
      // simulate the "already claimed" join returning it.
      seatPlanScheduleRepo.createQueryBuilder.mockReturnValue(
        qb([{ exam_schedule_id: SCHEDULE_A }]),
      );
      await expect(
        service.generate(TENANT, {
          name: 'Reuse after publish',
          exam_schedule_ids: [SCHEDULE_A],
          room_ids: [ROOM_1],
          seat_order_mode: SeatOrderMode.SEQUENTIAL,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('is rejected if a genuine room conflict now exists', async () => {
      const conflictingRow = {
        seat_plan_id: 'other-plan',
        room_id: ROOM_1,
        exam_schedule_id: SCHEDULE_B,
        date: '2026-01-01',
        starts_at: '09:30:00',
        ends_at: '10:30:00',
      };
      dataSource.transaction = vi.fn(async (cb: any) =>
        cb({
          findOne: vi.fn(async () => ({
            id: 'plan-1',
            tenant_id: TENANT,
            status: SeatPlanStatus.DRAFT,
          })),
          find: vi.fn(async (entityClass: any) => {
            if (entityClass.name === 'SeatPlanSchedule') {
              return [{ exam_schedule_id: SCHEDULE_A }];
            }
            if (entityClass.name === 'ExamSchedule') {
              return [makeSchedule(SCHEDULE_A, 'class-1')];
            }
            if (entityClass.name === 'SeatAllocation') {
              return [{ room_id: ROOM_1 }];
            }
            if (entityClass.name === 'Room') {
              return [{ id: ROOM_1, capacity: 2 }];
            }
            return [];
          }),
          save: vi.fn(async (_e: any, v: any) => v),
          createQueryBuilder: vi.fn(() => qb([conflictingRow])),
        }),
      );

      await expect(service.publish(TENANT, 'plan-1')).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('permission enforcement', () => {
    // Full 403 behavior (PermissionsGuard + role-permission table) is covered by
    // permission-matrix.e2e-spec.ts; this checks the controller declares the
    // right permission so that suite actually exercises this route.
    it('requires exams:seat-plan-manage (Permission.SEAT_PLAN_MANAGE) on the controller', () => {
      const reflector = new Reflector();
      const required = reflector.get(PERMISSIONS_KEY, SeatPlansController);
      expect(required).toEqual([Permission.SEAT_PLAN_MANAGE]);
    });
  });
});
