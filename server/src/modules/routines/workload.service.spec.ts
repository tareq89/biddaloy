import { describe, it, expect, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { WorkloadService } from './workload.service';

const TENANT_ID = 'tenant-1';

function buildService(overrides: { routine?: any; slots?: any[]; teacherRows?: any[] } = {}) {
  const routine =
    'routine' in overrides
      ? overrides.routine
      : { id: 'routine-1', tenant_id: TENANT_ID, deleted_at: null };
  const routineRepo: any = { findOne: vi.fn(async () => routine) };
  const slotRepo: any = { find: vi.fn(async () => overrides.slots ?? []) };
  const slotTeacherRepo: any = { find: vi.fn(async () => overrides.teacherRows ?? []) };

  const service = new WorkloadService(routineRepo, slotRepo, slotTeacherRepo);
  return { service, routineRepo, slotRepo, slotTeacherRepo };
}

describe('WorkloadService [21.6.1] D19', () => {
  it('404s for a routine outside the caller tenant', async () => {
    const ctx = buildService({ routine: null });
    await expect(ctx.service.forRoutine('routine-1', TENANT_ID)).rejects.toThrow(NotFoundException);
  });

  it('counts a plain (non-co-taught) slot toward its one teacher', async () => {
    const ctx = buildService({
      slots: [{ id: 'slot-1', weekday: 1, valid_to: null }],
      teacherRows: [{ routine_slot_id: 'slot-1', teacher_id: 't-1' }],
    });
    const result = await ctx.service.forRoutine('routine-1', TENANT_ID);
    expect(result).toEqual([{ teacher_id: 't-1', periods_per_week: 1, periods_per_day: { 1: 1 } }]);
  });

  it('counts a co-taught slot toward every teacher on it, not just the first', async () => {
    const ctx = buildService({
      slots: [{ id: 'slot-1', weekday: 2, valid_to: null }],
      teacherRows: [
        { routine_slot_id: 'slot-1', teacher_id: 't-1' },
        { routine_slot_id: 'slot-1', teacher_id: 't-2' },
      ],
    });
    const result = await ctx.service.forRoutine('routine-1', TENANT_ID);
    expect(result).toHaveLength(2);
    expect(result.find((r) => r.teacher_id === 't-1')).toMatchObject({ periods_per_week: 1 });
    expect(result.find((r) => r.teacher_id === 't-2')).toMatchObject({ periods_per_week: 1 });
  });

  it('sums periods-per-week and buckets periods-per-day across multiple slots for one teacher', async () => {
    const ctx = buildService({
      slots: [
        { id: 'slot-1', weekday: 1, valid_to: null },
        { id: 'slot-2', weekday: 1, valid_to: null },
        { id: 'slot-3', weekday: 3, valid_to: null },
      ],
      teacherRows: [
        { routine_slot_id: 'slot-1', teacher_id: 't-1' },
        { routine_slot_id: 'slot-2', teacher_id: 't-1' },
        { routine_slot_id: 'slot-3', teacher_id: 't-1' },
      ],
    });
    const result = await ctx.service.forRoutine('routine-1', TENANT_ID);
    expect(result).toEqual([
      { teacher_id: 't-1', periods_per_week: 3, periods_per_day: { 1: 2, 3: 1 } },
    ]);
  });
});
