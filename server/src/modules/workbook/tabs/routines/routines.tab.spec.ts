import { describe, expect, it } from 'vitest';
import { AcademicYear } from '../../../academics/entities/academic-year.entity';
import { Routine } from '../../../routines/entities/routine.entity';
import { RoutineState } from '@biddaloy/shared';
import { cellText, toCell } from '../../codec/cell-format';
import { assertRegistryValid } from '../../codec/registry';
import type { ExportContext, ImportContext } from '../../codec/tab-spec';
import { routinesTab, type RoutineRow } from './routines.tab';

const ROUTINE_ID = '7f3e4b2a-1c5d-4e8f-9a6b-2d1c3e4f5a6b';
const YEAR_ID = '22222222-2222-4222-8222-222222222222';
const TENANT_ID = '11111111-1111-4111-8111-111111111111';

const exportCtx: ExportContext = {
  keyOf: (tab, id) => (tab === 'academic_years' && id === YEAR_ID ? '2026-2027' : ''),
};
function makeImportCtx(): ImportContext {
  return {
    tenantId: TENANT_ID,
    ref: (tab, key) => (tab === 'academic_years' && key === '2026-2027' ? YEAR_ID : undefined),
    warn: () => undefined,
  };
}

function makeRoutine(overrides: Partial<Routine> = {}): Routine {
  return Object.assign(new Routine(), {
    id: ROUTINE_ID,
    academic_year_id: YEAR_ID,
    academic_year: Object.assign(new AcademicYear(), { id: YEAR_ID, name: '2026-2027' }),
    name: 'Main routine',
    state: RoutineState.PUBLISHED,
    published_at: new Date('2026-01-01T00:00:00.000Z'),
    tenant_id: TENANT_ID,
    ...overrides,
  } satisfies Partial<Routine>);
}

function toCells(routine: Routine): Record<string, string> {
  const row = routinesTab.toRow(routine, exportCtx);
  const cells: Record<string, string> = {};
  for (const column of routinesTab.columns) {
    const cell = toCell(column.type, row[column.key]);
    cells[column.key] = cellText(cell === null ? '' : String(cell));
  }
  return cells;
}

describe('routinesTab shape', () => {
  it('satisfies the registry contract', () => {
    expect(() => assertRegistryValid([routinesTab], { partial: true })).not.toThrow();
  });

  it('depends on academic_years, deletes by absence', () => {
    expect(routinesTab.name).toBe('routines');
    expect(routinesTab.dependsOn).toEqual(['academic_years']);
    expect(routinesTab.naturalKey).toEqual(['academic_year', 'name']);
    expect(routinesTab.deleteByAbsence).toBe(true);
  });
});

describe('round trip', () => {
  it('round-trips a published routine', () => {
    const routine = makeRoutine();
    const result = routinesTab.fromRow(toCells(routine), 2, makeImportCtx());

    expect(result).toEqual({
      row: {
        id: ROUTINE_ID,
        academic_year_id: YEAR_ID,
        academic_year_key: '2026-2027',
        name: 'Main routine',
        state: RoutineState.PUBLISHED,
        published_at: '2026-01-01T00:00:00.000Z',
      } satisfies RoutineRow,
    });
  });

  it('round-trips a draft routine with no published_at', () => {
    const routine = makeRoutine({ state: RoutineState.DRAFT, published_at: null });
    const result = routinesTab.fromRow(toCells(routine), 2, makeImportCtx());

    expect(result).toEqual({
      row: {
        id: ROUTINE_ID,
        academic_year_id: YEAR_ID,
        academic_year_key: '2026-2027',
        name: 'Main routine',
        state: RoutineState.DRAFT,
        published_at: null,
      } satisfies RoutineRow,
    });
  });
});

describe('diffFields', () => {
  it('reports a changed state', () => {
    const routine = makeRoutine();
    const row: RoutineRow = {
      id: ROUTINE_ID,
      academic_year_id: YEAR_ID,
      academic_year_key: '2026-2027',
      name: 'Main routine',
      state: RoutineState.REVIEW,
      published_at: '2026-01-01T00:00:00.000Z',
    };
    expect(routinesTab.diffFields(row, routine)).toEqual(['state']);
  });
});
