import { describe, expect, it } from 'vitest';
import { RoutineSlot } from '../../../routines/entities/routine-slot.entity';
import { RoutineSlotTeacher } from '../../../routines/entities/routine-slot-teacher.entity';
import { Teacher } from '../../../academics/entities/teacher.entity';
import { cellText, toCell } from '../../codec/cell-format';
import { assertRegistryValid } from '../../codec/registry';
import type { ExportContext, ImportContext } from '../../codec/tab-spec';
import { routineSlotTeachersTab, type RoutineSlotTeacherRow } from './routine-slot-teachers.tab';

const LINK_ID = '7f3e4b2a-1c5d-4e8f-9a6b-2d1c3e4f5a6b';
const SLOT_ID = '22222222-2222-4222-8222-222222222222';
const TEACHER_ID = '33333333-3333-4333-8333-333333333333';
const TENANT_ID = '11111111-1111-4111-8111-111111111111';

const keys: Record<string, Record<string, string>> = {
  routine_slots: { [SLOT_ID]: 'slot-key' },
  teachers: { [TEACHER_ID]: 'EMP-1' },
};

const exportCtx: ExportContext = { keyOf: (tab, id) => keys[tab]?.[id] ?? '' };
function makeImportCtx(): ImportContext {
  return {
    tenantId: TENANT_ID,
    ref: (tab, key) => {
      const table = keys[tab];
      const found = table && Object.entries(table).find(([, v]) => v === key);
      return found?.[0];
    },
    warn: () => undefined,
  };
}

function makeLink(overrides: Partial<RoutineSlotTeacher> = {}): RoutineSlotTeacher {
  return Object.assign(new RoutineSlotTeacher(), {
    id: LINK_ID,
    routine_slot_id: SLOT_ID,
    routine_slot: Object.assign(new RoutineSlot(), { id: SLOT_ID }),
    teacher_id: TEACHER_ID,
    teacher: Object.assign(new Teacher(), { id: TEACHER_ID, employee_id: 'EMP-1' }),
    tenant_id: TENANT_ID,
    ...overrides,
  } satisfies Partial<RoutineSlotTeacher>);
}

function toCells(link: RoutineSlotTeacher): Record<string, string> {
  const row = routineSlotTeachersTab.toRow(link, exportCtx);
  const cells: Record<string, string> = {};
  for (const column of routineSlotTeachersTab.columns) {
    const cell = toCell(column.type, row[column.key]);
    cells[column.key] = cellText(cell === null ? '' : String(cell));
  }
  return cells;
}

describe('routineSlotTeachersTab shape', () => {
  it('satisfies the registry contract', () => {
    expect(() => assertRegistryValid([routineSlotTeachersTab], { partial: true })).not.toThrow();
  });

  it('depends on routine_slots and teachers, deletes by absence', () => {
    expect(routineSlotTeachersTab.name).toBe('routine_slot_teachers');
    expect(routineSlotTeachersTab.dependsOn).toEqual(['routine_slots', 'teachers']);
    expect(routineSlotTeachersTab.naturalKey).toEqual(['routine_slot', 'teacher']);
  });
});

describe('round trip', () => {
  // The trap a naive codec flattens: a co-taught slot needs two of these
  // rows, one per teacher, for the same routine_slot.
  it('round-trips two rows for the same slot (co-taught)', () => {
    const linkOne = makeLink();
    const linkTwo = makeLink({
      id: '44444444-4444-4444-8444-444444444444',
      teacher_id: '55555555-5555-4555-8555-555555555555',
      teacher: Object.assign(new Teacher(), {
        id: '55555555-5555-4555-8555-555555555555',
        employee_id: 'EMP-2',
      }),
    });
    keys.teachers!['55555555-5555-4555-8555-555555555555'] = 'EMP-2';

    const resultOne = routineSlotTeachersTab.fromRow(toCells(linkOne), 2, makeImportCtx());
    const resultTwo = routineSlotTeachersTab.fromRow(toCells(linkTwo), 3, makeImportCtx());

    expect('errors' in resultOne).toBe(false);
    expect('errors' in resultTwo).toBe(false);
    if ('errors' in resultOne || 'errors' in resultTwo) return;
    expect(resultOne.row.routine_slot_key).toBe(resultTwo.row.routine_slot_key);
    expect(resultOne.row.teacher_key).not.toBe(resultTwo.row.teacher_key);
  });

  it('reports a RowError when the teacher ref misses', () => {
    const cells = { ...toCells(makeLink()), teacher: 'NONEXISTENT' };
    const result = routineSlotTeachersTab.fromRow(cells, 3, makeImportCtx());

    expect('errors' in result).toBe(true);
    if (!('errors' in result)) return;
    expect(result.errors[0]).toMatchObject({ column: 'teacher', row: 3 });
  });
});

describe('diffFields', () => {
  it('reports a changed teacher', () => {
    const link = makeLink();
    const row: RoutineSlotTeacherRow = {
      id: LINK_ID,
      routine_slot_id: SLOT_ID,
      routine_slot_key: 'slot-key',
      teacher_id: 'different-id',
      teacher_key: 'EMP-2',
    };
    expect(routineSlotTeachersTab.diffFields(row, link)).toEqual(['teacher']);
  });
});
