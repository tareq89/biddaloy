import { describe, expect, it } from 'vitest';
import { FineTrigger } from '@biddaloy/shared';
import { fineRulesTab, type FineRuleRow } from './fine-rules.tab';
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

function cellsFor(row: FineRuleRow): Record<string, string> {
  return {
    id: row.id,
    trigger: row.trigger,
    fee_structure: row.fee_structure_key,
    class: row.class_key ?? '',
    academic_year: row.academic_year_key,
    free_per_period: String(row.free_per_period),
    cap_per_period: row.cap_per_period ?? '',
    conditions: JSON.stringify(row.conditions),
    is_active: String(row.is_active),
  };
}

describe('fineRulesTab', () => {
  it('round-trips fromRow(toRow-shaped cells) for a class-scoped rule with conditions', () => {
    const row: FineRuleRow = {
      id: '00000000-0000-4000-8000-000000000001',
      trigger: FineTrigger.ATTENDANCE_LATE,
      fee_structure_id: 'fs-1',
      fee_structure_key: 'Fine - Late|2026-2027',
      class_id: 'class-1',
      class_key: 'Class 5|2026-2027',
      academic_year_id: 'year-1',
      academic_year_key: '2026-2027',
      free_per_period: 2,
      cap_per_period: '200.00',
      conditions: { min_minutes_late: 10 },
      is_active: true,
    };

    const ctx = fakeImportCtx({
      fee_structures: { 'Fine - Late|2026-2027': 'fs-1' },
      classes: { 'Class 5|2026-2027': 'class-1' },
      academic_years: { '2026-2027': 'year-1' },
    });

    const result = fineRulesTab.fromRow(cellsFor(row), 2, ctx);
    expect('row' in result).toBe(true);
    expect((result as { row: FineRuleRow }).row).toEqual(row);
  });

  it('round-trips a school-wide rule (null class) with an empty conditions object', () => {
    const row: FineRuleRow = {
      id: '00000000-0000-4000-8000-000000000002',
      trigger: FineTrigger.ATTENDANCE_ABSENT,
      fee_structure_id: 'fs-2',
      fee_structure_key: 'Fine - Absent|2026-2027',
      class_id: null,
      class_key: null,
      academic_year_id: 'year-1',
      academic_year_key: '2026-2027',
      free_per_period: 0,
      cap_per_period: null,
      conditions: {},
      is_active: true,
    };

    const ctx = fakeImportCtx({
      fee_structures: { 'Fine - Absent|2026-2027': 'fs-2' },
      academic_years: { '2026-2027': 'year-1' },
    });

    const result = fineRulesTab.fromRow(cellsFor(row), 2, ctx);
    expect('row' in result).toBe(true);
    expect((result as { row: FineRuleRow }).row).toEqual(row);
  });

  it('errors with a RowError naming the column and the key when a ref misses', () => {
    const row: FineRuleRow = {
      id: '00000000-0000-4000-8000-000000000001',
      trigger: FineTrigger.ATTENDANCE_LATE,
      fee_structure_id: 'fs-1',
      fee_structure_key: 'Missing Structure|2026-2027',
      class_id: null,
      class_key: null,
      academic_year_id: 'year-1',
      academic_year_key: '2026-2027',
      free_per_period: 0,
      cap_per_period: null,
      conditions: {},
      is_active: true,
    };
    const ctx = fakeImportCtx({ academic_years: { '2026-2027': 'year-1' } });
    const result = fineRulesTab.fromRow(cellsFor(row), 2, ctx);
    expect('errors' in result).toBe(true);
    const errors = (result as { errors: { column: string | null; value?: string }[] }).errors;
    expect(errors[0]).toMatchObject({
      column: 'fee_structure',
      value: 'Missing Structure|2026-2027',
    });
  });

  it('exports a null class and the jsonb conditions unchanged', () => {
    const entity = {
      id: 'fr-1',
      trigger: FineTrigger.ATTENDANCE_ABSENT,
      fee_structure_id: 'fs-1',
      class_id: null,
      academic_year_id: 'year-1',
      free_per_period: 3,
      cap_per_period: null,
      conditions: { min_minutes_late: 15 },
      is_active: true,
    } as any;

    const ctx = fakeExportCtx({
      academic_years: { 'year-1': '2026-2027' },
      fee_structures: { 'fs-1': 'Fine - Absent|2026-2027' },
    });

    const rowOut = fineRulesTab.toRow(entity, ctx);
    expect(rowOut.class).toBeNull();
    expect(rowOut.conditions).toEqual({ min_minutes_late: 15 });
  });

  it('keys two rules differing only by class distinctly (D22 partial uniqueness)', () => {
    const base = {
      id: '00000000-0000-4000-8000-000000000001',
      trigger: FineTrigger.ATTENDANCE_LATE,
      fee_structure_id: 'fs-1',
      fee_structure_key: 'Fine - Late|2026-2027',
      academic_year_id: 'year-1',
      academic_year_key: '2026-2027',
      free_per_period: 0,
      cap_per_period: null,
      conditions: {},
      is_active: true,
    };

    const schoolWide = { ...base, class_id: null, class_key: null } as FineRuleRow;
    const classScoped = {
      ...base,
      class_id: 'class-1',
      class_key: 'Class 5|2026-2027',
    } as FineRuleRow;

    expect(fineRulesTab.keyOf(schoolWide)).not.toBe(fineRulesTab.keyOf(classScoped));
    expect(fineRulesTab.naturalKey).toContain('class');
    expect(fineRulesTab.naturalKey).toContain('trigger');
  });

  it('keys an active and an inactive rule with the same year/trigger/class distinctly', () => {
    const active = {
      id: '00000000-0000-4000-8000-000000000001',
      trigger: FineTrigger.ATTENDANCE_LATE,
      academic_year_key: '2026-2027',
      class_key: null,
      is_active: true,
    } as unknown as FineRuleRow;
    const inactive = { ...active, is_active: false } as FineRuleRow;
    expect(fineRulesTab.keyOf(active)).not.toBe(fineRulesTab.keyOf(inactive));
  });
});
