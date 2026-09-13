import { describe, expect, it } from 'vitest';
import { FeeType } from '@biddaloy/shared';
import { feeStructuresTab, type FeeStructureRow } from './fee-structures.tab';
import type { ExportContext, ImportContext } from '../../codec/tab-spec';

function fakeImportCtx(refs: Record<string, Record<string, string>>): ImportContext {
  return {
    tenantId: 'tenant-1',
    ref: (tab, key) => refs[tab]?.[key],
    warn: () => undefined,
  };
}

function fakeExportCtx(keys: Record<string, Record<string, string>>): ExportContext {
  return {
    keyOf: (tab, id) => keys[tab]?.[id] ?? '',
  };
}

function cellsFor(row: FeeStructureRow): Record<string, string> {
  return {
    id: row.id,
    name: row.name,
    fee_type: row.fee_type,
    amount: row.amount,
    class: row.class_key ?? '',
    academic_year: row.academic_year_key,
    section: row.section_key ?? '',
  };
}

describe('feeStructuresTab', () => {
  it('round-trips fromRow(toRow-shaped cells)', () => {
    const row: FeeStructureRow = {
      id: '00000000-0000-4000-8000-000000000001',
      name: 'Tuition - January',
      fee_type: FeeType.MONTHLY_TUITION,
      amount: '1500.00',
      class_id: 'class-1',
      class_key: 'Class 5|2026-2027',
      academic_year_id: 'year-1',
      academic_year_key: '2026-2027',
      section_id: 'section-1',
      section_key: 'Class 5|2026-2027|A',
    };

    const ctx = fakeImportCtx({
      classes: { 'Class 5|2026-2027': 'class-1' },
      academic_years: { '2026-2027': 'year-1' },
      sections: { 'Class 5|2026-2027|A': 'section-1' },
    });

    const result = feeStructuresTab.fromRow(cellsFor(row), 2, ctx);
    expect('row' in result).toBe(true);
    expect((result as { row: FeeStructureRow }).row).toEqual(row);
  });

  it('errors with a RowError naming the column and the key when a ref misses', () => {
    const row: FeeStructureRow = {
      id: '00000000-0000-4000-8000-000000000001',
      name: 'Tuition',
      fee_type: FeeType.MONTHLY_TUITION,
      amount: '1500.00',
      class_id: 'class-1',
      class_key: 'Missing Class|2026-2027',
      academic_year_id: 'year-1',
      academic_year_key: '2026-2027',
      section_id: null,
      section_key: null,
    };
    const ctx = fakeImportCtx({ academic_years: { '2026-2027': 'year-1' } });
    const result = feeStructuresTab.fromRow(cellsFor(row), 2, ctx);
    expect('errors' in result).toBe(true);
    const errors = (result as { errors: { column: string | null; value?: string }[] }).errors;
    expect(errors[0]).toMatchObject({ column: 'class', value: 'Missing Class|2026-2027' });
  });

  it('exports a null class for a school-wide structure', () => {
    const entity = {
      id: 'fs-1',
      name: 'Tuition',
      fee_type: FeeType.MONTHLY_TUITION,
      amount: '1500.00',
      class_id: null,
      section_id: null,
      academic_year_id: 'year-1',
    } as any;

    const ctx = fakeExportCtx({
      academic_years: { 'year-1': '2026-2027' },
    });

    const rowOut = feeStructuresTab.toRow(entity, ctx);
    expect(rowOut.class).toBeNull();
    expect(rowOut.section).toBeNull();
  });

  it('keys two structures that differ only by section distinctly', () => {
    // `section` is nullable and independent of `class`, so one
    // class/year/type/name can carry a different amount per section.
    // With `section` left out of the key both rows collapsed onto one id and
    // delete-by-absence removed the loser.
    const base = {
      id: '00000000-0000-4000-8000-000000000001',
      name: 'Tuition',
      fee_type: FeeType.MONTHLY_TUITION,
      amount: '1500.00',
      class_id: 'class-1',
      class_key: 'Class 5|2026-2027',
      academic_year_id: 'year-1',
      academic_year_key: '2026-2027',
    };

    const sectionA = {
      ...base,
      section_id: 'sec-a',
      section_key: 'Class 5|2026-2027|A',
    } as FeeStructureRow;
    const sectionB = {
      ...base,
      section_id: 'sec-b',
      section_key: 'Class 5|2026-2027|B',
      amount: '1200.00',
    } as FeeStructureRow;

    expect(feeStructuresTab.keyOf(sectionA)).not.toBe(feeStructuresTab.keyOf(sectionB));
    expect(feeStructuresTab.naturalKey).toContain('section');
  });

  it('keys a school-wide structure distinctly from a class-scoped one with the same name', () => {
    const base = {
      id: '00000000-0000-4000-8000-000000000001',
      name: 'Tuition',
      fee_type: FeeType.MONTHLY_TUITION,
      amount: '1500.00',
      academic_year_id: 'year-1',
      academic_year_key: '2026-2027',
      section_id: null,
      section_key: null,
    };

    const schoolWide = {
      ...base,
      class_id: null,
      class_key: null,
    } as FeeStructureRow;
    const classScoped = {
      ...base,
      class_id: 'class-1',
      class_key: 'Class 5|2026-2027',
    } as FeeStructureRow;

    expect(feeStructuresTab.keyOf(schoolWide)).not.toBe(feeStructuresTab.keyOf(classScoped));
    expect(feeStructuresTab.naturalKey).toContain('class');
  });
});
