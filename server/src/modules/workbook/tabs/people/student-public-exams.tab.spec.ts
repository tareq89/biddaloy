import { describe, expect, it } from 'vitest';
import { PublicExamType } from '@biddaloy/shared';
import { StudentPublicExam } from '../../../students/entities/student-public-exam.entity';
import { Student } from '../../../students/entities/student.entity';
import { cellText, toCell } from '../../codec/cell-format';
import type { ExportContext, ImportContext, RowError } from '../../codec/tab-spec';
import {
  studentPublicExamsTab as tab,
  type StudentPublicExamRow,
} from './student-public-exams.tab';
import { studentsTab } from './students.tab';
import { peopleTabs } from './index';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const EXAM_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const STUDENT_ID = '66666666-6666-4666-8666-666666666666';

const KEYS: Record<string, Record<string, string>> = { students: { [STUDENT_ID]: 'S-001' } };

const exportCtx: ExportContext = { keyOf: (t, id) => KEYS[t]?.[id] ?? '' };
const importCtx: ImportContext = {
  tenantId: TENANT_ID,
  ref: (t, key) => Object.entries(KEYS[t] ?? {}).find(([, k]) => k === key)?.[0],
  warn: () => undefined,
};

function makeExam(overrides: Partial<StudentPublicExam> = {}): StudentPublicExam {
  return Object.assign(new StudentPublicExam(), {
    id: EXAM_ID,
    tenant_id: TENANT_ID,
    student_id: STUDENT_ID,
    student: Object.assign(new Student(), { registration_number: 'S-001' }),
    exam_type: PublicExamType.SSC,
    board: 'Dhaka',
    roll_no: '123456',
    registration_no: '9876543',
    gpa: '4.50',
    passing_year: 2024,
    ...overrides,
  });
}

function toCells(entity: StudentPublicExam): Record<string, string> {
  const row = tab.toRow(entity, exportCtx);
  const cells: Record<string, string> = {};
  for (const column of tab.columns) {
    const cell = toCell(column.type, row[column.key]);
    cells[column.key] = cellText(cell === null ? '' : String(cell));
  }
  return cells;
}

function rowOrThrow(cells: Record<string, string>): StudentPublicExamRow {
  const result = tab.fromRow(cells, 2, importCtx);
  if ('errors' in result) throw new Error(JSON.stringify(result.errors));
  return result.row;
}

describe('studentPublicExamsTab', () => {
  it('is registered after students, with the expected shape', () => {
    expect(peopleTabs.indexOf(tab)).toBeGreaterThan(peopleTabs.indexOf(studentsTab));
    expect(tab.name).toBe('student_public_exams');
    expect(tab.naturalKey).toEqual(['student', 'exam_type', 'passing_year']);
    expect(tab.columns[0].key).toBe('id');
  });

  it('round-trips encode/decode with the natural key', () => {
    const entity = makeExam();
    const row = rowOrThrow(toCells(entity));
    expect(row).toMatchObject({ student_id: STUDENT_ID, gpa: '4.50', passing_year: 2024 });
    expect(tab.keyOf(row)).toBe('S-001|SSC|2024');
    expect(tab.keyOf(row)).toBe(tab.keyOf(entity));
    expect(tab.diffFields(row, entity)).toEqual([]);
  });

  it('a null gpa round-trips as null', () => {
    const cells = toCells(makeExam({ gpa: null }));
    expect(cells.gpa).toBe('');
    expect(rowOrThrow(cells).gpa).toBeNull();
  });

  it('an unknown student yields a RowError naming the student column', () => {
    const cells = toCells(makeExam());
    cells.student = 'GHOST';
    const result = tab.fromRow(cells, 3, importCtx);
    expect((result as { errors: RowError[] }).errors[0].column).toBe('student');
  });

  it('two exams with the same natural key produce the same key (validator rejects the duplicate)', () => {
    const a = rowOrThrow(toCells(makeExam()));
    const b = rowOrThrow(toCells(makeExam({ id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' })));
    expect(tab.keyOf(a)).toBe(tab.keyOf(b));
  });

  it('diffFields reports only the changed field', () => {
    const entity = makeExam();
    const row = { ...rowOrThrow(toCells(entity)), board: 'Comilla' };
    expect(tab.diffFields(row, entity)).toEqual(['board']);
  });
});
