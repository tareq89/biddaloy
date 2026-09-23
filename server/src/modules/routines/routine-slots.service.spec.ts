import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { PeriodSlotKind, SlotRecurrence } from '@biddaloy/shared';
import { RoutineSlotsService } from './routine-slots.service';

const TENANT_ID = 'tenant-1';
const ROUTINE_ID = 'routine-1';

function buildService() {
  const routine = { id: ROUTINE_ID, tenant_id: TENANT_ID, deleted_at: null };
  const periodSlot = {
    id: 'period-1',
    tenant_id: TENANT_ID,
    kind: PeriodSlotKind.CLASS,
    sequence: 0,
  };

  const routineRepo: any = { findOne: vi.fn(async () => routine) };
  const slots: any[] = [];
  const slotTeachers: any[] = [];

  const slotRepo: any = {
    find: vi.fn(async () => slots),
    findOne: vi.fn(async ({ where }: any) => slots.find((s) => s.id === where.id) ?? null),
    create: vi.fn((v: any) => ({ id: `slot-${slots.length + 1}`, ...v })),
    save: vi.fn(async (v: any) => {
      slots.push(v);
      return v;
    }),
    update: vi.fn(async ({ id }: any, patch: any) => {
      const s = slots.find((x) => x.id === id);
      if (s) Object.assign(s, patch);
    }),
    delete: vi.fn(async () => undefined),
  };
  const slotTeacherRepo: any = {
    // Real `In(slotIds)` filtering isn't worth reimplementing here — this
    // suite never has more than one routine's rows in play, so returning
    // everything already scoped to this tenant/routine is equivalent.
    find: vi.fn(async () => slotTeachers),
    create: vi.fn((v: any) => v),
    save: vi.fn(async (rows: any[]) => {
      slotTeachers.push(...rows);
      return rows;
    }),
    delete: vi.fn(async () => undefined),
  };
  const periodSlotRepo: any = {
    find: vi.fn(async () => [periodSlot]),
    findOne: vi.fn(async () => periodSlot),
  };
  const tcsRepo: any = { find: vi.fn(async () => []) };
  const settingsReader: any = { routineSettings: vi.fn(async () => ({})) };

  const service = new RoutineSlotsService(
    routineRepo,
    slotRepo,
    slotTeacherRepo,
    periodSlotRepo,
    tcsRepo,
    settingsReader,
  );
  return {
    service,
    routineRepo,
    slotRepo,
    slotTeacherRepo,
    periodSlotRepo,
    tcsRepo,
    settingsReader,
    slots,
  };
}

const baseDto = {
  section_id: 'section-1',
  period_slot_id: 'period-1',
  weekday: 1,
  subject_id: 'subject-1',
  room_id: null,
  recurrence: SlotRecurrence.WEEKLY,
  recurrence_offset: 0,
  valid_from: '2026-01-01',
  valid_to: null,
  teacher_ids: ['teacher-1'],
};

describe('RoutineSlotsService [21.4.1]', () => {
  let ctx: ReturnType<typeof buildService>;

  beforeEach(() => {
    ctx = buildService();
  });

  it('create() throws NotFoundException for a routine outside the tenant', async () => {
    ctx.routineRepo.findOne = vi.fn(async () => null);
    await expect(ctx.service.create(ROUTINE_ID, baseDto as any, TENANT_ID)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('create() saves a slot with no clashes and returns no violations', async () => {
    const result = await ctx.service.create(ROUTINE_ID, baseDto as any, TENANT_ID);
    expect(result.slot.section_id).toBe('section-1');
    expect(ctx.slotTeacherRepo.save).toHaveBeenCalled();
  });

  it('create() refuses a hard-constraint violation (BREAK slot) without writing', async () => {
    ctx.periodSlotRepo.findOne = vi.fn(async () => ({
      id: 'period-1',
      tenant_id: TENANT_ID,
      kind: PeriodSlotKind.BREAK,
      sequence: 0,
    }));
    await expect(ctx.service.create(ROUTINE_ID, baseDto as any, TENANT_ID)).rejects.toThrow(
      ConflictException,
    );
    expect(ctx.slotRepo.save).not.toHaveBeenCalled();
  });

  it('remove() throws NotFoundException for a slot outside the tenant', async () => {
    await expect(ctx.service.remove('missing-slot', TENANT_ID)).rejects.toThrow(NotFoundException);
  });

  it('update() closes the old row (D4) rather than mutating it in place', async () => {
    const created = await ctx.service.create(ROUTINE_ID, baseDto as any, TENANT_ID);
    const oldId = created.slot.id;

    await ctx.service.update(
      oldId,
      { ...baseDto, valid_from: '2026-06-01', subject_id: 'subject-2' } as any,
      TENANT_ID,
    );

    // The old row is closed the day before the new one starts, never
    // deleted or mutated to the new subject.
    const oldRow = ctx.slots.find((s: any) => s.id === oldId);
    expect(oldRow.valid_to).toBe('2026-05-31');
    expect(oldRow.subject_id).toBe('subject-1');

    // A new row exists carrying the new fields.
    const newRow = ctx.slots.find((s: any) => s.id !== oldId);
    expect(newRow).toBeDefined();
    expect(newRow.subject_id).toBe('subject-2');
    expect(newRow.valid_from).toBe('2026-06-01');
  });
});
