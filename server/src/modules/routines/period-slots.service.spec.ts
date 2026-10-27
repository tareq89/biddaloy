import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PeriodSlotKind } from '@biddaloy/shared';
import { PeriodSlotsService } from './period-slots.service';

const TENANT_ID = 'tenant-1';
const SHIFT = {
  id: 'shift-1',
  tenant_id: TENANT_ID,
  day_starts_at: '08:00:00',
  day_ends_at: '14:00:00',
};

function buildService() {
  const shiftRepo: any = { findOne: vi.fn(async () => SHIFT) };
  const routineSlotRepo: any = { count: vi.fn(async () => 0) };
  const deliveryRepo: any = { count: vi.fn(async () => 0) };
  const repo: any = {
    find: vi.fn(async () => []),
    create: vi.fn((v: any) => v),
    delete: vi.fn(async () => undefined),
    update: vi.fn(async () => undefined),
    save: vi.fn(async (v: any) => v),
    manager: {
      // `replaceForShift` now locks the shift row and reads
      // `RoutineSlot` counts via the transaction manager too — route
      // each entity to the same mock the rest of this suite asserts on.
      transaction: vi.fn(async (cb: any) =>
        cb({
          getRepository: (entity: any) => {
            if (entity?.name === 'Shift') return shiftRepo;
            if (entity?.name === 'RoutineSlot') return routineSlotRepo;
            if (entity?.name === 'LessonDelivery') return deliveryRepo;
            return repo;
          },
        }),
      ),
    },
  };
  const settingsReader: any = {
    routineSettings: vi.fn(async () => ({ defaultChangeoverMinutes: 5 })),
  };
  const service = new PeriodSlotsService(shiftRepo, repo, routineSlotRepo, settingsReader);
  return { service, shiftRepo, repo, routineSlotRepo, deliveryRepo, settingsReader };
}

const validSlots = [
  { sequence: 0, kind: PeriodSlotKind.CLASS, starts_at: '08:00', ends_at: '08:40' },
  { sequence: 1, kind: PeriodSlotKind.CLASS, starts_at: '08:45', ends_at: '09:25' },
];

describe('PeriodSlotsService [21.3.1]', () => {
  let ctx: ReturnType<typeof buildService>;

  beforeEach(() => {
    ctx = buildService();
  });

  it('findForShift throws NotFoundException for a shift outside the tenant', async () => {
    ctx.shiftRepo.findOne = vi.fn(async () => null);
    await expect(ctx.service.findForShift('shift-1', TENANT_ID)).rejects.toThrow(NotFoundException);
  });

  it('replaceForShift accepts an ordered, non-overlapping, in-window set', async () => {
    const result = await ctx.service.replaceForShift(
      'shift-1',
      { slots: validSlots } as any,
      TENANT_ID,
    );
    // Empty shift: both rows are new, nothing is deleted.
    expect(ctx.repo.delete).not.toHaveBeenCalled();
    expect(ctx.repo.save).toHaveBeenCalledWith([
      expect.objectContaining({ sequence: 0 }),
      expect.objectContaining({ sequence: 1 }),
    ]);
    expect(result).toEqual([]);
  });

  it('locks the existing period-slot rows before counting references, to race-proof against a concurrent RoutineSlotsService write', async () => {
    await ctx.service.replaceForShift('shift-1', { slots: validSlots } as any, TENANT_ID);
    expect(ctx.repo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { shift_id: 'shift-1', tenant_id: TENANT_ID },
        lock: { mode: 'pessimistic_write' },
      }),
    );
  });

  it('rejects overlapping slots and reports every problem, not just the first', async () => {
    const overlapping = [
      { sequence: 0, kind: PeriodSlotKind.CLASS, starts_at: '08:00', ends_at: '08:40' },
      // Overlaps slot 0, and also starts after it ends — but this asserts
      // multiple *distinct* problems surface together, not on one slot.
      { sequence: 1, kind: PeriodSlotKind.CLASS, starts_at: '08:30', ends_at: '20:00' },
    ];
    await expect(
      ctx.service.replaceForShift('shift-1', { slots: overlapping } as any, TENANT_ID),
    ).rejects.toThrow(BadRequestException);
    expect(ctx.repo.delete).not.toHaveBeenCalled();
  });

  it('rejects a slot outside the shift day window', async () => {
    const outOfWindow = [
      { sequence: 0, kind: PeriodSlotKind.CLASS, starts_at: '07:00', ends_at: '07:40' },
    ];
    await expect(
      ctx.service.replaceForShift('shift-1', { slots: outOfWindow } as any, TENANT_ID),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects duplicate sequences', async () => {
    const duplicateSequence = [
      { sequence: 0, kind: PeriodSlotKind.CLASS, starts_at: '08:00', ends_at: '08:40' },
      { sequence: 0, kind: PeriodSlotKind.CLASS, starts_at: '09:00', ends_at: '09:40' },
    ];
    await expect(
      ctx.service.replaceForShift('shift-1', { slots: duplicateSequence } as any, TENANT_ID),
    ).rejects.toThrow(BadRequestException);
  });

  const OLD = [
    { id: 'p1', kind: PeriodSlotKind.CLASS },
    { id: 'p2', kind: PeriodSlotKind.CLASS },
  ];
  const keepP1 = {
    id: 'p1',
    sequence: 0,
    kind: PeriodSlotKind.CLASS,
    starts_at: '08:00',
    ends_at: '08:40',
  };
  const keepP2 = {
    id: 'p2',
    sequence: 1,
    kind: PeriodSlotKind.CLASS,
    starts_at: '08:45',
    ends_at: '09:25',
  };

  it('updates kept rows in place even when they are in use', async () => {
    ctx.repo.find = vi.fn(async () => OLD);
    ctx.routineSlotRepo.count = vi.fn(async () => 3);
    await ctx.service.replaceForShift('shift-1', { slots: [keepP1, keepP2] } as any, TENANT_ID);
    // Nothing removed or made a break, so no reference check and no delete.
    expect(ctx.routineSlotRepo.count).not.toHaveBeenCalled();
    expect(ctx.repo.delete).not.toHaveBeenCalled();
    expect(ctx.repo.update).toHaveBeenCalledWith(
      { id: 'p2', tenant_id: TENANT_ID },
      expect.objectContaining({ sequence: 1, starts_at: '08:45' }),
    );
  });

  it('refuses to remove a period that a routine slot uses, without echoing ids', async () => {
    ctx.repo.find = vi.fn(async () => OLD);
    ctx.routineSlotRepo.count = vi.fn(async () => 1);
    const err: any = await ctx.service
      .replaceForShift('shift-1', { slots: [keepP1] } as any, TENANT_ID)
      .catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse().details.code).toBe('PERIOD_SLOT_IN_USE');
    expect(JSON.stringify(err.getResponse())).not.toContain('shift-1');
    expect(ctx.repo.delete).not.toHaveBeenCalled();
  });

  it('refuses to make a period a break when lesson deliveries use it', async () => {
    ctx.repo.find = vi.fn(async () => OLD);
    ctx.deliveryRepo.count = vi.fn(async () => 2);
    await expect(
      ctx.service.replaceForShift(
        'shift-1',
        { slots: [keepP1, { ...keepP2, kind: PeriodSlotKind.BREAK }] } as any,
        TENANT_ID,
      ),
    ).rejects.toThrow(ConflictException);
    expect(ctx.repo.update).not.toHaveBeenCalled();
  });

  it('rejects an id that is not one of the shift rows', async () => {
    ctx.repo.find = vi.fn(async () => OLD);
    await expect(
      ctx.service.replaceForShift(
        'shift-1',
        { slots: [{ ...keepP1, id: 'other' }] } as any,
        TENANT_ID,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('suggestChangeover spaces periods by defaultChangeoverMinutes from day_starts_at', async () => {
    const suggestions = await ctx.service.suggestChangeover(
      'shift-1',
      { periodCount: 2, periodDurationMinutes: 40 } as any,
      TENANT_ID,
    );
    expect(suggestions).toEqual([
      { sequence: 0, starts_at: '08:00', ends_at: '08:40' },
      // 40-minute period + 5-minute changeover (stubbed setting) later.
      { sequence: 1, starts_at: '08:45', ends_at: '09:25' },
    ]);
  });
});
