import { describe, expect, it, vi } from 'vitest';
import type { ImportContext, RowError } from '../../codec/tab-spec';
import { admissionIntakesTab, type AdmissionIntakeRow } from './admission-intakes.tab';

const ID = '7f3e4b2a-1c5d-4e8f-9a6b-2d1c3e4f5a6b';
const CLASS_A = 'Class 1|2026-2027||';
const CLASS_B = 'Class 2|2026-2027||';

const ctx = (): ImportContext => ({
  tenantId: '11111111-1111-4111-8111-111111111111',
  ref: () => ID,
  warn: vi.fn<(e: RowError) => void>(),
});

const cells = (over: Record<string, string>) => ({
  id: ID,
  class_section: '',
  class: CLASS_A,
  academic_year: '2026-2027',
  title: 'Admission 2027',
  seat_count: '40',
  open_date: '2026-11-01',
  close_date: '2026-12-01',
  template_key: 'APPLY_ONLY',
  roll_counter: '0',
  show_names_publicly: 'false',
  widget_always_show: 'false',
  auto_activate_lists: 'false',
  ...over,
});

describe('admissionIntakesTab', () => {
  it('two section-less rounds of different classes get different keys', () => {
    const a = admissionIntakesTab.fromRow(cells({}), 2, ctx());
    const b = admissionIntakesTab.fromRow(cells({ class: CLASS_B }), 2, ctx());
    if (!('row' in a) || !('row' in b)) throw new Error('rows should parse');
    expect(admissionIntakesTab.keyOf(a.row as AdmissionIntakeRow)).not.toBe(
      admissionIntakesTab.keyOf(b.row as AdmissionIntakeRow),
    );
  });

  it('a class and academic_year that name different years is a row error', () => {
    const r = admissionIntakesTab.fromRow(cells({ academic_year: '2025-2026' }), 2, ctx());
    expect('errors' in r && r.errors[0].column).toBe('academic_year');
  });

  it('a blank academic_year is not a contradiction', () => {
    expect(admissionIntakesTab.fromRow(cells({ academic_year: '' }), 2, ctx())).toHaveProperty(
      'row',
    );
  });
});
