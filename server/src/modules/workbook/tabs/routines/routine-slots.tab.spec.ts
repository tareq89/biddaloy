import { describe, expect, it } from 'vitest';
import { AcademicYear } from '../../../academics/entities/academic-year.entity';
import { Class } from '../../../academics/entities/class.entity';
import { ClassSection } from '../../../academics/entities/class-section.entity';
import { Subject } from '../../../academics/entities/subject.entity';
import { Shift } from '../../../routines/entities/shift.entity';
import { PeriodSlot } from '../../../routines/entities/period-slot.entity';
import { Room } from '../../../routines/entities/room.entity';
import { Routine } from '../../../routines/entities/routine.entity';
import { RoutineSlot } from '../../../routines/entities/routine-slot.entity';
import { SlotRecurrence, RoutineState } from '@biddaloy/shared';
import { cellText, toCell } from '../../codec/cell-format';
import { assertRegistryValid } from '../../codec/registry';
import type { ExportContext, ImportContext } from '../../codec/tab-spec';
import { routineSlotsTab, type RoutineSlotRow } from './routine-slots.tab';

const SLOT_ID = '7f3e4b2a-1c5d-4e8f-9a6b-2d1c3e4f5a6b';
const ROUTINE_ID = '22222222-2222-4222-8222-222222222222';
const SECTION_ID = '33333333-3333-4333-8333-333333333333';
const PERIOD_SLOT_ID = '44444444-4444-4444-8444-444444444444';
const SUBJECT_ID = '55555555-5555-4555-8555-555555555555';
const ROOM_ID = '66666666-6666-4666-8666-666666666666';
const YEAR_ID = '77777777-7777-4777-8777-777777777777';
const CLASS_ID = '88888888-8888-4888-8888-888888888888';
const SHIFT_ID = '99999999-9999-4999-8999-999999999999';
const TENANT_ID = '11111111-1111-4111-8111-111111111111';

const keys: Record<string, Record<string, string>> = {
  routines: { [ROUTINE_ID]: '2026-2027|Main routine' },
  sections: { [SECTION_ID]: 'Class 10|2026-2027||A' },
  period_slots: { [PERIOD_SLOT_ID]: 'Morning|1' },
  subjects: { [SUBJECT_ID]: 'MATH' },
  rooms: { [ROOM_ID]: 'Building A|204' },
};

const exportCtx: ExportContext = { keyOf: (tab, id) => keys[tab]?.[id] ?? '' };
function makeImportCtx(): ImportContext {
  return {
    tenantId: TENANT_ID,
    ref: (tab, key) => {
      const table = keys[tab];
      if (!table) return undefined;
      const found = Object.entries(table).find(([, v]) => v === key);
      return found?.[0];
    },
    warn: () => undefined,
  };
}

function makeSlot(overrides: Partial<RoutineSlot> = {}): RoutineSlot {
  const academicYear = Object.assign(new AcademicYear(), { id: YEAR_ID, name: '2026-2027' });
  const klass = Object.assign(new Class(), {
    id: CLASS_ID,
    name: 'Class 10',
    academic_year: academicYear,
    shift: null,
    version: null,
  });
  const section = Object.assign(new ClassSection(), {
    id: SECTION_ID,
    section_name: 'A',
    class: klass,
  });
  const shift = Object.assign(new Shift(), { id: SHIFT_ID, name: 'Morning' });
  const periodSlot = Object.assign(new PeriodSlot(), { id: PERIOD_SLOT_ID, sequence: 1, shift });
  const routine = Object.assign(new Routine(), {
    id: ROUTINE_ID,
    name: 'Main routine',
    academic_year: academicYear,
  });
  const subject = Object.assign(new Subject(), { id: SUBJECT_ID, code: 'MATH' });
  const room = Object.assign(new Room(), { id: ROOM_ID, building: 'Building A', room_no: '204' });

  return Object.assign(new RoutineSlot(), {
    id: SLOT_ID,
    routine_id: ROUTINE_ID,
    routine,
    section_id: SECTION_ID,
    section,
    period_slot_id: PERIOD_SLOT_ID,
    period_slot: periodSlot,
    weekday: 1,
    subject_id: SUBJECT_ID,
    subject,
    room_id: ROOM_ID,
    room,
    recurrence: SlotRecurrence.WEEKLY,
    recurrence_offset: 0,
    valid_from: '2026-01-01',
    valid_to: null,
    tenant_id: TENANT_ID,
    ...overrides,
  } satisfies Partial<RoutineSlot>);
}

function toCells(slot: RoutineSlot): Record<string, string> {
  const row = routineSlotsTab.toRow(slot, exportCtx);
  const cells: Record<string, string> = {};
  for (const column of routineSlotsTab.columns) {
    const cell = toCell(column.type, row[column.key]);
    cells[column.key] = cellText(cell === null ? '' : String(cell));
  }
  return cells;
}

describe('routineSlotsTab shape', () => {
  it('satisfies the registry contract', () => {
    expect(() => assertRegistryValid([routineSlotsTab], { partial: true })).not.toThrow();
  });

  it('depends on routines, sections, period_slots, subjects, rooms', () => {
    expect(routineSlotsTab.name).toBe('routine_slots');
    expect(routineSlotsTab.dependsOn).toEqual([
      'routines',
      'sections',
      'period_slots',
      'subjects',
      'rooms',
    ]);
    expect(routineSlotsTab.naturalKey).toEqual([
      'routine',
      'section',
      'period_slot',
      'weekday',
      'valid_from',
    ]);
  });
});

describe('round trip', () => {
  it('round-trips a weekly slot with a room', () => {
    const slot = makeSlot();
    const result = routineSlotsTab.fromRow(toCells(slot), 2, makeImportCtx());

    expect(result).toEqual({
      row: {
        id: SLOT_ID,
        routine_id: ROUTINE_ID,
        routine_key: '2026-2027|Main routine',
        section_id: SECTION_ID,
        section_key: 'Class 10|2026-2027||A',
        period_slot_id: PERIOD_SLOT_ID,
        period_slot_key: 'Morning|1',
        weekday: 1,
        subject_id: SUBJECT_ID,
        subject_key: 'MATH',
        room_id: ROOM_ID,
        room_key: 'Building A|204',
        recurrence: SlotRecurrence.WEEKLY,
        recurrence_offset: 0,
        valid_from: '2026-01-01',
        valid_to: null,
      } satisfies RoutineSlotRow,
    });
  });

  // The trap a naive codec flattens: a biweekly slot on the second week.
  it('round-trips a biweekly slot with recurrence_offset = 1', () => {
    const slot = makeSlot({
      recurrence: SlotRecurrence.BIWEEKLY,
      recurrence_offset: 1,
      room_id: null,
      room: null,
    });
    const result = routineSlotsTab.fromRow(toCells(slot), 2, makeImportCtx());

    expect('errors' in result).toBe(false);
    if ('errors' in result) return;
    expect(result.row.recurrence).toBe(SlotRecurrence.BIWEEKLY);
    expect(result.row.recurrence_offset).toBe(1);
    expect(result.row.room_id).toBeNull();
  });

  // The trap a naive codec flattens: a monthly slot on the *last*
  // occurrence of the cycle (-1), not the first.
  it('round-trips a monthly slot with offset = -1 (last)', () => {
    const slot = makeSlot({
      recurrence: SlotRecurrence.MONTHLY,
      recurrence_offset: -1,
      room_id: null,
      room: null,
    });
    const result = routineSlotsTab.fromRow(toCells(slot), 2, makeImportCtx());

    expect('errors' in result).toBe(false);
    if ('errors' in result) return;
    expect(result.row.recurrence).toBe(SlotRecurrence.MONTHLY);
    expect(result.row.recurrence_offset).toBe(-1);
  });

  // The trap a naive codec flattens: a superseded row with `valid_to` set.
  it('round-trips a slot with valid_to set (superseded)', () => {
    const slot = makeSlot({ valid_to: '2026-02-01' });
    const result = routineSlotsTab.fromRow(toCells(slot), 2, makeImportCtx());

    expect('errors' in result).toBe(false);
    if ('errors' in result) return;
    expect(result.row.valid_to).toBe('2026-02-01');
  });
});

describe('diffFields', () => {
  it('reports a changed room', () => {
    const slot = makeSlot();
    const row: RoutineSlotRow = {
      id: SLOT_ID,
      routine_id: ROUTINE_ID,
      routine_key: '2026-2027|Main routine',
      section_id: SECTION_ID,
      section_key: 'Class 10|2026-2027||A',
      period_slot_id: PERIOD_SLOT_ID,
      period_slot_key: 'Morning|1',
      weekday: 1,
      subject_id: SUBJECT_ID,
      subject_key: 'MATH',
      room_id: null,
      room_key: null,
      recurrence: SlotRecurrence.WEEKLY,
      recurrence_offset: 0,
      valid_from: '2026-01-01',
      valid_to: null,
    };
    expect(routineSlotsTab.diffFields(row, slot)).toEqual(['room']);
  });
});
