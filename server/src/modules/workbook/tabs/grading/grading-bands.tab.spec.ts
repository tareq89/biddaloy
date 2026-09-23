import { describe, expect, it } from 'vitest';
import { AcademicYear } from '../../../academics/entities/academic-year.entity';
import { GradingBand } from '../../../grading/entities/grading-band.entity';
import { GradingScale } from '../../../grading/entities/grading-scale.entity';
import { cellText, toCell } from '../../codec/cell-format';
import { assertRegistryValid } from '../../codec/registry';
import type { ExportContext, ImportContext } from '../../codec/tab-spec';
import { gradingBandsTab, type GradingBandRow } from './grading-bands.tab';
import { gradingScalesTab } from './grading-scales.tab';
import { gradingTabs } from './index';

const BAND_ID = '7f3e4b2a-1c5d-4e8f-9a6b-2d1c3e4f5a6e';
const SCALE_ID = '7f3e4b2a-1c5d-4e8f-9a6b-2d1c3e4f5a6a';
const YEAR_ID = '22222222-2222-4222-8222-222222222222';
const TENANT_ID = '11111111-1111-4111-8111-111111111111';

const exportCtx: ExportContext = {
  keyOf: (tab, id) => (tab === 'grading_scales' && id === SCALE_ID ? 'BD NCTB|2026-2027|' : ''),
};

function makeImportCtx(overrides: Partial<ImportContext> = {}): ImportContext {
  return {
    tenantId: TENANT_ID,
    ref: (tab, key) =>
      tab === 'grading_scales' && key === 'BD NCTB|2026-2027|' ? SCALE_ID : undefined,
    warn: () => undefined,
    ...overrides,
  };
}

function makeScale(): GradingScale {
  return Object.assign(new GradingScale(), {
    id: SCALE_ID,
    name: 'BD NCTB',
    academic_year_id: YEAR_ID,
    academic_year: Object.assign(new AcademicYear(), { id: YEAR_ID, name: '2026-2027' }),
    class_id: null,
    class: null,
    revision: 1,
    tenant_id: TENANT_ID,
  });
}

function makeBand(overrides: Partial<GradingBand> = {}): GradingBand {
  return Object.assign(new GradingBand(), {
    id: BAND_ID,
    scale_id: SCALE_ID,
    scale: makeScale(),
    percent_from: 80,
    percent_to: 100,
    grade: 'A+',
    gpa: '5.00',
    is_fail: false,
    sequence: 1,
    comment: null,
    tenant_id: TENANT_ID,
    ...overrides,
  } satisfies Partial<GradingBand>);
}

function toCells(band: GradingBand): Record<string, string> {
  const row = gradingBandsTab.toRow(band, exportCtx);
  const cells: Record<string, string> = {};
  for (const column of gradingBandsTab.columns) {
    const cell = toCell(column.type, row[column.key]);
    cells[column.key] = cellText(cell === null ? '' : String(cell));
  }
  return cells;
}

describe('gradingBandsTab shape', () => {
  it('is registered through the grading barrel, after grading_scales', () => {
    expect(gradingTabs).toContain(gradingBandsTab);
    expect(gradingTabs.indexOf(gradingBandsTab)).toBeGreaterThan(
      gradingTabs.indexOf(gradingScalesTab),
    );
  });

  it('satisfies the registry contract together with grading_scales', () => {
    expect(() =>
      assertRegistryValid([gradingScalesTab, gradingBandsTab], { partial: true }),
    ).not.toThrow();
  });

  it('depends on grading_scales, keys by scale + sequence, deletes by absence', () => {
    expect(gradingBandsTab.name).toBe('grading_bands');
    expect(gradingBandsTab.dependsOn).toEqual(['grading_scales']);
    expect(gradingBandsTab.naturalKey).toEqual(['scale', 'sequence']);
    expect(gradingBandsTab.deleteByAbsence).toBe(true);
  });

  it('keys a band by its scale key and sequence, never a uuid', () => {
    const key = gradingBandsTab.keyOf(makeBand());
    expect(key).toBe('BD NCTB|2026-2027||1');
    expect(key).not.toContain(BAND_ID);
    expect(key).not.toContain(SCALE_ID);
  });
});

describe('round trip', () => {
  it('returns equivalent values through toRow then fromRow, with a real gpa', () => {
    const band = makeBand();

    const result = gradingBandsTab.fromRow(toCells(band), 2, makeImportCtx());

    expect(result).toEqual({
      row: {
        id: BAND_ID,
        scale_id: SCALE_ID,
        scale_key: 'BD NCTB|2026-2027|',
        percent_from: 80,
        percent_to: 100,
        grade: 'A+',
        gpa: '5.00',
        is_fail: false,
        sequence: 1,
        comment: null,
      } satisfies GradingBandRow,
    });
  });

  it('round-trips a null gpa (D4: a letter-only band never computes one)', () => {
    const band = makeBand({
      grade: 'Pass',
      gpa: null,
      sequence: 2,
      percent_from: 33,
      percent_to: 79,
    });

    const result = gradingBandsTab.fromRow(toCells(band), 2, makeImportCtx());

    expect('row' in result).toBe(true);
    if (!('row' in result)) return;
    expect(result.row.gpa).toBeNull();
  });

  it('reports a RowError naming the column and key on a scale ref miss', () => {
    const cells = { ...toCells(makeBand()), scale: 'nonexistent scale key' };

    const result = gradingBandsTab.fromRow(cells, 3, makeImportCtx());

    expect('errors' in result).toBe(true);
    if (!('errors' in result)) return;
    expect(result.errors[0]).toMatchObject({
      column: 'scale',
      row: 3,
      value: 'nonexistent scale key',
    });
  });
});

describe('diffFields', () => {
  it('reports a changed gpa, including a transition to/from null', () => {
    const band = makeBand({ gpa: '5.00' });
    const row: GradingBandRow = {
      id: BAND_ID,
      scale_id: SCALE_ID,
      scale_key: 'unused',
      percent_from: 80,
      percent_to: 100,
      grade: 'A+',
      gpa: null,
      is_fail: false,
      sequence: 1,
      comment: null,
    };

    expect(gradingBandsTab.diffFields(row, band)).toEqual(['gpa']);
  });
});
