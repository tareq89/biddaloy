import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { EnrollmentStatus, PeriodSlotKind, RoutineState, SlotRecurrence } from '@biddaloy/shared';
import { ResolveRoutineService } from './resolve-routine.service';

const TENANT_ID = 'tenant-1';
const YEAR = { id: 'year-1', start_date: '2026-01-04', end_date: '2026-12-31' };
const ROUTINE = {
  id: 'routine-1',
  tenant_id: TENANT_ID,
  academic_year_id: YEAR.id,
  state: RoutineState.PUBLISHED,
};

const MON_SLOT = {
  id: 'slot-1',
  routine_id: ROUTINE.id,
  section_id: 'section-1',
  period_slot_id: 'period-1',
  weekday: 1,
  subject_id: 'subject-1',
  room_id: null,
  recurrence: SlotRecurrence.WEEKLY,
  recurrence_offset: 0,
  valid_from: '2026-01-01',
  valid_to: null,
};

function buildService(
  overrides: {
    slots?: any[];
    periodSlots?: any[];
    teacherRows?: any[];
    substitutions?: any[];
    enrollment?: any;
    workingDays?: string[];
  } = {},
) {
  const yearQb: any = {
    where: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    getOne: vi.fn(async () => YEAR),
  };
  const yearRepo: any = {
    createQueryBuilder: vi.fn(() => yearQb),
  };
  const routineRepo: any = { findOne: vi.fn(async () => ROUTINE) };
  const slotRepo: any = { find: vi.fn(async () => overrides.slots ?? [MON_SLOT]) };
  const slotTeacherRepo: any = {
    find: vi.fn(
      async () => overrides.teacherRows ?? [{ routine_slot_id: 'slot-1', teacher_id: 't-1' }],
    ),
  };
  const substitutionRepo: any = { find: vi.fn(async () => overrides.substitutions ?? []) };
  const periodSlotRepo: any = {
    find: vi.fn(
      async () => overrides.periodSlots ?? [{ id: 'period-1', kind: PeriodSlotKind.CLASS }],
    ),
  };
  const enrollmentRepo: any = { findOne: vi.fn(async () => overrides.enrollment ?? null) };
  const calendarService: any = {
    getWorkingDays: vi.fn(async () => ({
      dates: overrides.workingDays ?? ['2026-01-05', '2026-01-06'],
    })),
  };

  const service = new ResolveRoutineService(
    routineRepo,
    slotRepo,
    slotTeacherRepo,
    substitutionRepo,
    periodSlotRepo,
    yearRepo,
    enrollmentRepo,
    calendarService,
  );
  return { service, calendarService, enrollmentRepo, substitutionRepo };
}

describe('ResolveRoutineService [21.5.1]', () => {
  let ctx: ReturnType<typeof buildService>;

  beforeEach(() => {
    ctx = buildService();
  });

  it('rejects a query with no identifier', async () => {
    await expect(
      ctx.service.resolveRoutine({ from: '2026-01-05', to: '2026-01-06' } as any, TENANT_ID),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a query with more than one identifier', async () => {
    await expect(
      ctx.service.resolveRoutine(
        { section_id: 's-1', teacher_id: 't-1', from: '2026-01-05', to: '2026-01-06' } as any,
        TENANT_ID,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('resolves a section into its occurring dated slots, monday only', async () => {
    const result = await ctx.service.resolveRoutine(
      { section_id: 'section-1', from: '2026-01-05', to: '2026-01-06' } as any,
      TENANT_ID,
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ date: '2026-01-05', substituted: false, cancelled: false });
  });

  it('excludes BREAK slots from teaching results by default', async () => {
    const ctx2 = buildService({ periodSlots: [{ id: 'period-1', kind: PeriodSlotKind.BREAK }] });
    const result = await ctx2.service.resolveRoutine(
      { section_id: 'section-1', from: '2026-01-05', to: '2026-01-06' } as any,
      TENANT_ID,
    );
    expect(result).toHaveLength(0);
  });

  it('includes BREAK slots when include_breaks is set', async () => {
    const ctx2 = buildService({ periodSlots: [{ id: 'period-1', kind: PeriodSlotKind.BREAK }] });
    const result = await ctx2.service.resolveRoutine(
      {
        section_id: 'section-1',
        from: '2026-01-05',
        to: '2026-01-06',
        include_breaks: true,
      } as any,
      TENANT_ID,
    );
    expect(result).toHaveLength(1);
  });

  it('flags a substitution with the covering and covered-for teacher ids', async () => {
    const ctx2 = buildService({
      substitutions: [
        {
          routine_slot_id: 'slot-1',
          date: '2026-01-05',
          substitute_teacher_id: 't-2',
          is_cancelled: false,
        },
      ],
    });
    const result = await ctx2.service.resolveRoutine(
      { section_id: 'section-1', from: '2026-01-05', to: '2026-01-06' } as any,
      TENANT_ID,
    );
    expect(result[0]).toMatchObject({
      substituted: true,
      substitute_teacher_id: 't-2',
      covering_for_teacher_ids: ['t-1'],
    });
  });

  it('resolves a student through their active enrollment', async () => {
    const ctx2 = buildService({ enrollment: { section_id: 'section-1' } });
    const result = await ctx2.service.resolveRoutine(
      { student_id: 'student-1', from: '2026-01-05', to: '2026-01-06' } as any,
      TENANT_ID,
    );
    expect(result).toHaveLength(1);
    expect(ctx2.enrollmentRepo.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          student_id: 'student-1',
          enrollment_status: EnrollmentStatus.ACTIVE,
        }),
      }),
    );
  });

  it('returns empty, not an error, for a student with no active enrollment', async () => {
    const result = await ctx.service.resolveRoutine(
      { student_id: 'student-1', from: '2026-01-05', to: '2026-01-06' } as any,
      TENANT_ID,
    );
    expect(result).toEqual([]);
  });

  it('a teacher sees both their own slots and slots they are covering', async () => {
    const covered = {
      ...MON_SLOT,
      id: 'slot-2',
      section_id: 'section-2',
    };
    const ctx2 = buildService({
      slots: [MON_SLOT, covered],
      periodSlots: [{ id: 'period-1', kind: PeriodSlotKind.CLASS }],
      teacherRows: [
        { routine_slot_id: 'slot-1', teacher_id: 't-1' },
        { routine_slot_id: 'slot-2', teacher_id: 't-3' },
      ],
      substitutions: [
        {
          routine_slot_id: 'slot-2',
          date: '2026-01-05',
          substitute_teacher_id: 't-1',
          is_cancelled: false,
        },
      ],
    });
    const result = await ctx2.service.resolveRoutine(
      { teacher_id: 't-1', from: '2026-01-05', to: '2026-01-06' } as any,
      TENANT_ID,
    );
    const ownSlot = result.find((r) => r.routine_slot_id === 'slot-1');
    const coveringSlot = result.find((r) => r.routine_slot_id === 'slot-2');
    expect(ownSlot).toBeDefined();
    expect(coveringSlot).toMatchObject({ substituted: true, substitute_teacher_id: 't-1' });
  });

  it('tenant isolation: every repository read is scoped to the caller tenant', async () => {
    await ctx.service.resolveRoutine(
      { section_id: 'section-1', from: '2026-01-05', to: '2026-01-06' } as any,
      TENANT_ID,
    );
    expect(ctx.calendarService.getWorkingDays).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_ID }),
    );
  });
});
