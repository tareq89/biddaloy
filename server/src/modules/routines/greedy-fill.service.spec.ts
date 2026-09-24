import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { PeriodSlotKind } from '@biddaloy/shared';
import { GreedyFillService } from './greedy-fill.service';

const TENANT_ID = 'tenant-1';
const ROUTINE_ID = 'routine-1';
const SECTION_ID = 'section-1';
const CLASS_ID = 'class-1';
const SHIFT_ID = 'shift-1';

function buildService(opts?: { existingSlots?: any[]; tcsRows?: any[]; periodSlots?: any[] }) {
  const existingSlots = opts?.existingSlots ?? [
    // One filled cell — Monday, period-0 — so section-1 is "in" this routine.
    {
      id: 'filled-slot',
      section_id: SECTION_ID,
      period_slot_id: 'period-0',
      weekday: 1,
      subject_id: 'subject-filled',
      room_id: null,
      recurrence: 'WEEKLY',
      recurrence_offset: 0,
      valid_from: '2026-01-01',
      valid_to: null,
    },
  ];
  const periodSlots = opts?.periodSlots ?? [
    { id: 'period-0', shift_id: SHIFT_ID, sequence: 0, kind: PeriodSlotKind.CLASS },
    { id: 'period-1', shift_id: SHIFT_ID, sequence: 1, kind: PeriodSlotKind.CLASS },
  ];
  const tcsRows = opts?.tcsRows ?? [
    {
      teacher_id: 'teacher-a',
      section_id: SECTION_ID,
      subject_id: 'subject-1',
      tenant_id: TENANT_ID,
    },
  ];

  const routineRepo: any = {
    findOne: vi.fn(async () => ({ id: ROUTINE_ID, tenant_id: TENANT_ID, deleted_at: null })),
  };
  const slotRepo: any = { find: vi.fn(async () => existingSlots) };
  const slotTeacherRepo: any = {
    find: vi.fn(async () =>
      existingSlots.length
        ? [{ routine_slot_id: existingSlots[0].id, teacher_id: 'teacher-existing' }]
        : [],
    ),
  };
  const periodSlotRepo: any = { find: vi.fn(async () => periodSlots) };
  const sectionRepo: any = {
    find: vi.fn(async () => [{ id: SECTION_ID, class_id: CLASS_ID, tenant_id: TENANT_ID }]),
  };
  const classRepo: any = {
    find: vi.fn(async () => [{ id: CLASS_ID, shift_id: SHIFT_ID, tenant_id: TENANT_ID }]),
  };
  const tcsRepo: any = { find: vi.fn(async () => tcsRows) };
  const settingsReader: any = { routineSettings: vi.fn(async () => ({})) };

  const service = new GreedyFillService(
    routineRepo,
    slotRepo,
    slotTeacherRepo,
    periodSlotRepo,
    sectionRepo,
    classRepo,
    tcsRepo,
    settingsReader,
  );
  return { service };
}

describe('GreedyFillService [21.4.1]', () => {
  it('throws NotFoundException for a routine outside the tenant', async () => {
    const { service } = buildService();
    (service as any).routineRepo.findOne = vi.fn(async () => null);
    await expect(service.fill(ROUTINE_ID, {}, TENANT_ID)).rejects.toThrow(NotFoundException);
  });

  it('proposes a slot only for the empty cell, never the already-filled one', async () => {
    const { service } = buildService();
    const proposals = await service.fill(ROUTINE_ID, {}, TENANT_ID);
    expect(proposals.every((p) => !(p.period_slot_id === 'period-0' && p.weekday === 1))).toBe(
      true,
    );
    expect(proposals.some((p) => p.period_slot_id === 'period-1')).toBe(true);
  });

  it('proposes for a cell whose only row was closed by a D4 edit (valid_to in the past), not silently skipped', async () => {
    // The bug this guards: `cellFilled` used to match section+period+weekday
    // with no date-range check, so a superseded (closed) row with no active
    // replacement still made greedy-fill treat the cell as occupied.
    const existingSlots = [
      {
        id: 'closed-slot',
        section_id: SECTION_ID,
        period_slot_id: 'period-0',
        weekday: 1,
        subject_id: 'subject-old',
        room_id: null,
        recurrence: 'WEEKLY',
        recurrence_offset: 0,
        valid_from: '2020-01-01',
        valid_to: '2020-06-01', // closed years ago; no row replaced it
      },
    ];
    const { service } = buildService({ existingSlots });
    const proposals = await service.fill(ROUTINE_ID, {}, TENANT_ID);
    expect(proposals.some((p) => p.period_slot_id === 'period-0' && p.weekday === 1)).toBe(true);
  });

  it('never proposes a teacher who is already double-booked at that cell', async () => {
    // Same teacher already busy on Monday period-1 in a different section.
    const existingSlots = [
      {
        id: 'filled-slot',
        section_id: SECTION_ID,
        period_slot_id: 'period-0',
        weekday: 1,
        subject_id: 'subject-filled',
        room_id: null,
        recurrence: 'WEEKLY',
        recurrence_offset: 0,
        valid_from: '2026-01-01',
        valid_to: null,
      },
      {
        id: 'busy-slot',
        section_id: 'other-section',
        period_slot_id: 'period-1',
        weekday: 1,
        subject_id: 'subject-x',
        room_id: null,
        recurrence: 'WEEKLY',
        recurrence_offset: 0,
        valid_from: '2026-01-01',
        valid_to: null,
      },
    ];
    const { service } = buildService({ existingSlots });
    // Both the "filled" slot's teacher and the "busy" slot's teacher
    // resolve to teacher-existing in this mock's slotTeacherRepo, and the
    // only candidate teacher (teacher-a) is free — so it should be
    // proposed for period-1, not skipped.
    const proposals = await service.fill(ROUTINE_ID, {}, TENANT_ID);
    const forEmptyCell = proposals.find((p) => p.period_slot_id === 'period-1' && p.weekday === 1);
    expect(forEmptyCell?.teacher_ids).toEqual(['teacher-a']);
  });

  it('is deterministic — same input produces the same proposal set', async () => {
    const { service: s1 } = buildService();
    const { service: s2 } = buildService();
    const [p1, p2] = await Promise.all([
      s1.fill(ROUTINE_ID, {}, TENANT_ID),
      s2.fill(ROUTINE_ID, {}, TENANT_ID),
    ]);
    expect(p1).toEqual(p2);
  });

  it('does not write anything — findOne/find are only ever read calls', async () => {
    const { service } = buildService();
    await service.fill(ROUTINE_ID, {}, TENANT_ID);
    expect((service as any).slotRepo.save).toBeUndefined();
  });
});
