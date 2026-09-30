import { describe, expect, it } from 'vitest';
import { StudentLifecycleEventType } from '@biddaloy/shared';
import { StudentLifecycleEvent } from '../../../students/entities/student-lifecycle-event.entity';
import { Student } from '../../../students/entities/student.entity';
import { cellText, toCell } from '../../codec/cell-format';
import type { ExportContext, ImportContext, RowError } from '../../codec/tab-spec';
import {
  studentLifecycleEventsTab as tab,
  type StudentLifecycleEventRow,
} from './student-lifecycle-events.tab';
import { studentsTab } from './students.tab';
import { enrollmentsTab } from './enrollments.tab';
import { peopleTabs } from './index';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const EVENT_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const STUDENT_ID = '66666666-6666-4666-8666-666666666666';
const ENROLLMENT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const YEAR_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_ID = '77777777-7777-4777-8777-777777777777';

const KEYS: Record<string, Record<string, string>> = {
  students: { [STUDENT_ID]: 'S-001' },
  enrollments: { [ENROLLMENT_ID]: 'S-001|2026' },
  academic_years: { [YEAR_ID]: '2026' },
  users: { [USER_ID]: 'admin@x.test' },
};

const exportCtx: ExportContext = { keyOf: (t, id) => KEYS[t]?.[id] ?? '' };
const importCtx: ImportContext = {
  tenantId: TENANT_ID,
  ref: (t, key) => Object.entries(KEYS[t] ?? {}).find(([, k]) => k === key)?.[0],
  warn: () => undefined,
};

function makeEvent(overrides: Partial<StudentLifecycleEvent> = {}): StudentLifecycleEvent {
  return Object.assign(new StudentLifecycleEvent(), {
    id: EVENT_ID,
    tenant_id: TENANT_ID,
    student_id: STUDENT_ID,
    student: Object.assign(new Student(), { registration_number: 'S-001' }),
    enrollment_id: ENROLLMENT_ID,
    academic_year_id: YEAR_ID,
    event_type: StudentLifecycleEventType.WITHDRAWN,
    occurred_on: '2026-03-09',
    reason: 'Family moved',
    destination: null,
    remark: 'n/a',
    recorded_by_user_id: USER_ID,
    created_at: new Date('2026-03-09T10:00:00.000Z'),
    ...overrides,
  });
}

function toCells(entity: StudentLifecycleEvent): Record<string, string> {
  const row = tab.toRow(entity, exportCtx);
  const cells: Record<string, string> = {};
  for (const column of tab.columns) {
    const cell = toCell(column.type, row[column.key]);
    cells[column.key] = cellText(cell === null ? '' : String(cell));
  }
  return cells;
}

function rowOrThrow(cells: Record<string, string>): StudentLifecycleEventRow {
  const result = tab.fromRow(cells, 2, importCtx);
  if ('errors' in result) throw new Error(JSON.stringify(result.errors));
  return result.row;
}

describe('studentLifecycleEventsTab', () => {
  it('is registered after students and enrollments, with the expected shape', () => {
    expect(peopleTabs.indexOf(tab)).toBeGreaterThan(peopleTabs.indexOf(studentsTab));
    expect(peopleTabs.indexOf(tab)).toBeGreaterThan(peopleTabs.indexOf(enrollmentsTab));
    expect(tab.name).toBe('student_lifecycle_events');
    expect(tab.naturalKey).toEqual(['student', 'event_type', 'occurred_on']);
    expect(tab.columns[0].key).toBe('id');
  });

  it('exports the header row: every column key is unique', () => {
    const keys = tab.columns.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain('event_type');
  });

  it('round-trips encode/decode with the natural key', () => {
    const entity = makeEvent();
    const row = rowOrThrow(toCells(entity));
    expect(row).toMatchObject({
      student_id: STUDENT_ID,
      enrollment_id: ENROLLMENT_ID,
      academic_year_id: YEAR_ID,
      recorded_by_user_id: USER_ID,
      occurred_on: '2026-03-09',
      created_at: '2026-03-09T10:00:00.000Z',
    });
    expect(tab.keyOf(row)).toBe('S-001|WITHDRAWN|2026-03-09');
    expect(tab.keyOf(row)).toBe(tab.keyOf(entity));
    expect(tab.diffFields(row, entity)).toEqual([]);
  });

  it('an unknown student yields a RowError naming the student column', () => {
    const cells = toCells(makeEvent());
    cells.student = 'GHOST';
    const result = tab.fromRow(cells, 3, importCtx);
    expect((result as { errors: RowError[] }).errors[0].column).toBe('student');
  });

  it('two events with the same natural key produce the same key (validator rejects the duplicate)', () => {
    const a = rowOrThrow(toCells(makeEvent()));
    const b = rowOrThrow(toCells(makeEvent({ id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' })));
    expect(tab.keyOf(a)).toBe(tab.keyOf(b));
  });

  it('diffFields reports only the changed field', () => {
    const entity = makeEvent();
    const row = { ...rowOrThrow(toCells(entity)), reason: 'Changed' };
    expect(tab.diffFields(row, entity)).toEqual(['reason']);
  });

  it('a nullable recorded_by stays null', () => {
    const cells = toCells(makeEvent({ recorded_by_user_id: null }));
    expect(cells.recorded_by).toBe('');
    expect(rowOrThrow(cells).recorded_by_user_id).toBeNull();
  });
});
