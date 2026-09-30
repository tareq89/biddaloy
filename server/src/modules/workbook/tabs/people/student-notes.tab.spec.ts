import { describe, expect, it } from 'vitest';
import { StudentNote } from '../../../students/entities/student-note.entity';
import { Student } from '../../../students/entities/student.entity';
import { cellText, toCell } from '../../codec/cell-format';
import type { ExportContext, ImportContext, RowError } from '../../codec/tab-spec';
import { studentNotesTab as tab, type StudentNoteRow } from './student-notes.tab';
import { studentsTab } from './students.tab';
import { peopleTabs } from './index';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const NOTE_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const STUDENT_ID = '66666666-6666-4666-8666-666666666666';
const USER_ID = '77777777-7777-4777-8777-777777777777';

const KEYS: Record<string, Record<string, string>> = {
  students: { [STUDENT_ID]: 'S-001' },
  users: { [USER_ID]: 'teacher@x.test' },
};

const exportCtx: ExportContext = { keyOf: (t, id) => KEYS[t]?.[id] ?? '' };
const importCtx: ImportContext = {
  tenantId: TENANT_ID,
  ref: (t, key) => Object.entries(KEYS[t] ?? {}).find(([, k]) => k === key)?.[0],
  warn: () => undefined,
};

/** `author_key` is what `load()` stamps on a note; the spec does the same by hand. */
function makeNote(overrides: Partial<StudentNote> = {}): StudentNote {
  return Object.assign(new StudentNote(), {
    id: NOTE_ID,
    tenant_id: TENANT_ID,
    student_id: STUDENT_ID,
    student: Object.assign(new Student(), { registration_number: 'S-001' }),
    author_user_id: USER_ID,
    author_key: 'teacher@x.test',
    body: 'Needs extra reading time',
    rating: 4,
    created_at: new Date('2026-04-01T08:30:00.000Z'),
    ...overrides,
  });
}

function toCells(entity: StudentNote): Record<string, string> {
  const row = tab.toRow(entity, exportCtx);
  const cells: Record<string, string> = {};
  for (const column of tab.columns) {
    const cell = toCell(column.type, row[column.key]);
    cells[column.key] = cellText(cell === null ? '' : String(cell));
  }
  return cells;
}

function rowOrThrow(cells: Record<string, string>): StudentNoteRow {
  const result = tab.fromRow(cells, 2, importCtx);
  if ('errors' in result) throw new Error(JSON.stringify(result.errors));
  return result.row;
}

describe('studentNotesTab', () => {
  it('is registered after students, with the expected shape', () => {
    expect(peopleTabs.indexOf(tab)).toBeGreaterThan(peopleTabs.indexOf(studentsTab));
    expect(tab.name).toBe('student_notes');
    expect(tab.naturalKey).toEqual(['student', 'created_at', 'author']);
    expect(tab.columns.map((c) => c.key)).toEqual([
      'id',
      'student',
      'author',
      'body',
      'rating',
      'created_at',
    ]);
  });

  it('round-trips encode/decode with the natural key', () => {
    const entity = makeNote();
    const row = rowOrThrow(toCells(entity));
    expect(row).toMatchObject({
      student_id: STUDENT_ID,
      author_user_id: USER_ID,
      rating: 4,
      created_at: '2026-04-01T08:30:00.000Z',
    });
    expect(tab.keyOf(row)).toBe('S-001|2026-04-01T08:30:00.000Z|teacher@x.test');
    expect(tab.keyOf(row)).toBe(tab.keyOf(entity));
    expect(tab.diffFields(row, entity)).toEqual([]);
  });

  it('round-trips a null rating and rejects an out-of-range one', () => {
    const nullRow = rowOrThrow(toCells(makeNote({ rating: null })));
    expect(nullRow.rating).toBeNull();
    expect(tab.diffFields(nullRow, makeNote({ rating: null }))).toEqual([]);
    const cells = toCells(makeNote());
    cells.rating = '6';
    const result = tab.fromRow(cells, 5, importCtx);
    expect((result as { errors: RowError[] }).errors[0].column).toBe('rating');
  });

  it('an unknown student yields a RowError naming the student column', () => {
    const cells = toCells(makeNote());
    cells.student = 'GHOST';
    const result = tab.fromRow(cells, 3, importCtx);
    expect((result as { errors: RowError[] }).errors[0].column).toBe('student');
  });

  it('an unknown author yields a RowError naming the author column', () => {
    const cells = toCells(makeNote());
    cells.author = 'nobody@x.test';
    const result = tab.fromRow(cells, 4, importCtx);
    expect((result as { errors: RowError[] }).errors[0].column).toBe('author');
  });

  it('two notes with the same natural key produce the same key (validator rejects the duplicate)', () => {
    const a = rowOrThrow(toCells(makeNote()));
    const b = rowOrThrow(toCells(makeNote({ id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' })));
    expect(tab.keyOf(a)).toBe(tab.keyOf(b));
  });

  it('diffFields reports only the changed field', () => {
    const entity = makeNote();
    const row = { ...rowOrThrow(toCells(entity)), body: 'Edited' };
    expect(tab.diffFields(row, entity)).toEqual(['body']);
  });
});
