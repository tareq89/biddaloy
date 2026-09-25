import { describe, expect, it } from 'vitest';
import { PromotionOutcome, PromotionRunStatus, PlacementAlgorithm } from '@biddaloy/shared';
import { PromotionEntry } from '../../../promotions/entities/promotion-entry.entity';
import { PromotionRun } from '../../../promotions/entities/promotion-run.entity';
import { Class } from '../../../academics/entities/class.entity';
import { AcademicYear } from '../../../academics/entities/academic-year.entity';
import { Student } from '../../../students/entities/student.entity';
import { cellText, toCell } from '../../codec/cell-format';
import type { ExportContext, ImportContext, RowError } from '../../codec/tab-spec';
import { promotionEntriesTab, type PromotionEntryRow } from './promotion-entries.tab';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const ENTRY_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const RUN_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const STUDENT_ID = '66666666-6666-4666-8666-666666666666';
const SOURCE_CLASS_ID = '99999999-9999-4999-8999-999999999999';
const SOURCE_YEAR_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TARGET_YEAR_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ENROLLMENT_ID = '77777777-7777-4777-8777-777777777777';
const SECTION_ID = '88888888-8888-4888-8888-888888888888';
const USER_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

function makeRun(): PromotionRun {
  const year = Object.assign(new AcademicYear(), {
    id: SOURCE_YEAR_ID,
    name: '2026-2027',
    tenant_id: TENANT_ID,
  } satisfies Partial<AcademicYear>);
  const klass = Object.assign(new Class(), {
    id: SOURCE_CLASS_ID,
    name: 'Class 6',
    academic_year_id: SOURCE_YEAR_ID,
    academic_year: year,
    shift: null,
    version: null,
    tenant_id: TENANT_ID,
  } satisfies Partial<Class>);
  const run = Object.assign(new PromotionRun(), {
    id: RUN_ID,
    source_class_id: SOURCE_CLASS_ID,
    source_class: klass,
    source_academic_year_id: SOURCE_YEAR_ID,
    target_academic_year_id: TARGET_YEAR_ID,
    target_class_id: null,
    exam_ids: [],
    algorithm: PlacementAlgorithm.BLOCK,
    status: PromotionRunStatus.COMMITTED,
    refreshed_at: new Date('2026-03-01T00:00:00.000Z'),
    committed_at: new Date('2026-03-02T00:00:00.000Z'),
    committed_by_user_id: USER_ID,
    approved_by_user_id: USER_ID,
    override_count: 1,
    created_by_user_id: USER_ID,
    tenant_id: TENANT_ID,
  } satisfies Partial<PromotionRun>);
  return run;
}

function makeStudent(): Student {
  return Object.assign(new Student(), {
    id: STUDENT_ID,
    registration_number: 'S-001',
    tenant_id: TENANT_ID,
  } satisfies Partial<Student>);
}

function makeEntry(overrides: Partial<PromotionEntry> = {}): PromotionEntry {
  const entry = Object.assign(new PromotionEntry(), {
    id: ENTRY_ID,
    run_id: RUN_ID,
    run: makeRun(),
    student_id: STUDENT_ID,
    source_enrollment_id: ENROLLMENT_ID,
    source_section_id: SECTION_ID,
    merit_rank: 1,
    mean_gpa: '4.50',
    total_marks_sum: '167.00',
    passed_all: true,
    suggested_outcome: PromotionOutcome.PROMOTE,
    final_outcome: PromotionOutcome.PROMOTE,
    is_override: false,
    override_note: null,
    overridden_by_user_id: null,
    group_name: null,
    target_class_id: null,
    target_section_id: null,
    new_roll_number: null,
    placement_error: null,
    target_enrollment_id: null,
    tenant_id: TENANT_ID,
    ...overrides,
  } satisfies Partial<PromotionEntry>);
  // `load()` stashes this field itself (see its own docstring) — a
  // hand-built fixture must stash it too, or `keyOf` loses the student key.
  (
    entry as PromotionEntry & { _student_registration_number?: string }
  )._student_registration_number = makeStudent().registration_number;
  return entry;
}

const RUN_KEY = 'Class 6|2026-2027|||2027-2028';

const KEY_INDEX: Record<string, Record<string, string>> = {
  promotion_runs: { [RUN_KEY]: RUN_ID },
  students: { 'S-001': STUDENT_ID },
  enrollments: { 'S-001|2026-2027': ENROLLMENT_ID },
  sections: { 'Class 6|2026-2027|2026-2027|A': SECTION_ID },
};

function exportCtx(): ExportContext {
  return {
    keyOf: (tab: string, id: string) => {
      if (tab === 'promotion_runs') return RUN_KEY;
      if (tab === 'students') return id === STUDENT_ID ? 'S-001' : '';
      if (tab === 'enrollments') return id === ENROLLMENT_ID ? 'S-001|2026-2027' : '';
      if (tab === 'sections') return id === SECTION_ID ? 'Class 6|2026-2027|2026-2027|A' : '';
      return '';
    },
  };
}

function importCtx(): ImportContext {
  return {
    tenantId: TENANT_ID,
    ref: (tab: string, key: string) => KEY_INDEX[tab]?.[key],
    warn: () => undefined,
  };
}

function toCells(entity: PromotionEntry): Record<string, string> {
  const row = promotionEntriesTab.toRow(entity, exportCtx());
  const cells: Record<string, string> = {};
  for (const column of promotionEntriesTab.columns) {
    const cell = toCell(column.type, row[column.key]);
    cells[column.key] = cellText(cell === null ? '' : String(cell));
  }
  return cells;
}

function fromRowOrThrow(cells: Record<string, string>): PromotionEntryRow {
  const result = promotionEntriesTab.fromRow(cells, 2, importCtx());
  if ('errors' in result) {
    throw new Error(`Unexpected errors: ${JSON.stringify(result.errors)}`);
  }
  return result.row;
}

describe('promotionEntriesTab shape', () => {
  it('declares its dependency and identity shape', () => {
    expect(promotionEntriesTab.name).toBe('promotion_entries');
    expect(promotionEntriesTab.dependsOn).toEqual([
      'promotion_runs',
      'students',
      'enrollments',
      'sections',
      'classes',
    ]);
    expect(promotionEntriesTab.naturalKey).toEqual(['run', 'student']);
    expect(promotionEntriesTab.deleteByAbsence).toBe(true);
  });
});

describe('round-trip', () => {
  it('fromRow(toRow(entity)) round-trips a plain (non-override) entry', () => {
    const entry = makeEntry();
    const cells = toCells(entry);
    const row = fromRowOrThrow(cells);

    expect(row.run_id).toBe(RUN_ID);
    expect(row.student_id).toBe(STUDENT_ID);
    expect(row.source_enrollment_id).toBe(ENROLLMENT_ID);
    expect(row.is_override).toBe(false);
    expect(row.override_note).toBeNull();
    expect(promotionEntriesTab.keyOf(row)).toBe(promotionEntriesTab.keyOf(entry));
  });

  it('fromRow(toRow(entity)) round-trips an override entry, note preserved', () => {
    const entry = makeEntry({
      final_outcome: PromotionOutcome.RETAIN,
      is_override: true,
      override_note: 'Medical absence during annual exam — approved by head teacher',
      overridden_by_user_id: USER_ID,
    });
    const cells = toCells(entry);
    const row = fromRowOrThrow(cells);

    expect(row.is_override).toBe(true);
    expect(row.override_note).toBe('Medical absence during annual exam — approved by head teacher');
    expect(row.final_outcome).toBe(PromotionOutcome.RETAIN);
  });

  it('is_override=true with a blank override_note is a RowError (mirrors the DB CHECK)', () => {
    const cells = toCells(makeEntry({ is_override: true, override_note: 'irrelevant' }));
    cells.override_note = '   ';
    const result = promotionEntriesTab.fromRow(cells, 3, importCtx());
    expect('errors' in result).toBe(true);
    expect((result as { errors: RowError[] }).errors[0].column).toBe('override_note');
  });

  it('is_override=false with no override_note is not an error', () => {
    const cells = toCells(makeEntry());
    const row = fromRowOrThrow(cells);
    expect(row.is_override).toBe(false);
    expect(row.override_note).toBeNull();
  });

  it('an unresolvable run key yields a RowError naming the run column', () => {
    const cells = toCells(makeEntry());
    cells.run = 'Ghost Class|1999||1999';
    const result = promotionEntriesTab.fromRow(cells, 4, importCtx());
    expect('errors' in result).toBe(true);
    expect((result as { errors: RowError[] }).errors[0].column).toBe('run');
  });

  it('an unresolvable source_enrollment key yields a RowError naming that column', () => {
    const cells = toCells(makeEntry());
    cells.source_enrollment = 'S-999|1999';
    const result = promotionEntriesTab.fromRow(cells, 5, importCtx());
    expect('errors' in result).toBe(true);
    expect((result as { errors: RowError[] }).errors[0].column).toBe('source_enrollment');
  });
});

describe('diffFields', () => {
  it('reports nothing for an unchanged pair', () => {
    const entry = makeEntry();
    const row: PromotionEntryRow = {
      id: entry.id,
      run_id: entry.run_id,
      student_id: entry.student_id,
      source_enrollment_id: entry.source_enrollment_id,
      source_section_id: entry.source_section_id,
      merit_rank: entry.merit_rank,
      mean_gpa: entry.mean_gpa,
      total_marks_sum: entry.total_marks_sum,
      passed_all: entry.passed_all,
      suggested_outcome: entry.suggested_outcome,
      final_outcome: entry.final_outcome,
      is_override: entry.is_override,
      override_note: entry.override_note,
      overridden_by_user_id: entry.overridden_by_user_id,
      group_name: entry.group_name,
      target_class_id: entry.target_class_id,
      target_section_id: entry.target_section_id,
      new_roll_number: entry.new_roll_number,
      placement_error: entry.placement_error,
      target_enrollment_id: entry.target_enrollment_id,
      run_key: RUN_KEY,
      student_key: 'S-001',
    };
    expect(promotionEntriesTab.diffFields(row, entry)).toEqual([]);
  });

  it('reports exactly ["is_override", "override_note"] when an override is added', () => {
    const entry = makeEntry();
    const row: PromotionEntryRow = {
      id: entry.id,
      run_id: entry.run_id,
      student_id: entry.student_id,
      source_enrollment_id: entry.source_enrollment_id,
      source_section_id: entry.source_section_id,
      merit_rank: entry.merit_rank,
      mean_gpa: entry.mean_gpa,
      total_marks_sum: entry.total_marks_sum,
      passed_all: entry.passed_all,
      suggested_outcome: entry.suggested_outcome,
      final_outcome: entry.final_outcome,
      is_override: true,
      override_note: 'Medical absence during annual exam — approved by head teacher',
      overridden_by_user_id: entry.overridden_by_user_id,
      group_name: entry.group_name,
      target_class_id: entry.target_class_id,
      target_section_id: entry.target_section_id,
      new_roll_number: entry.new_roll_number,
      placement_error: entry.placement_error,
      target_enrollment_id: entry.target_enrollment_id,
      run_key: RUN_KEY,
      student_key: 'S-001',
    };
    expect(promotionEntriesTab.diffFields(row, entry)).toEqual(['is_override', 'override_note']);
  });
});
