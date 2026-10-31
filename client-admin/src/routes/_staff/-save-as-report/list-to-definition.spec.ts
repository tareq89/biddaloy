// @vitest-environment jsdom
import { FilterOp, ReportLayoutType, ReportParamType, ReportSubjectArea } from '@biddaloy/shared';
import { afterEach, describe, expect, it } from 'vitest';

import { planListReport, readVisibleColumns } from './list-to-definition';

const names = { className: 'Class 8', sectionName: 'A' };

describe('students list', () => {
  const plan = planListReport({
    kind: 'students',
    filters: {
      class_id: 'c1',
      section_id: 's1',
      shift: 'Morning',
      version: 'Bangla',
      enrollment_status: 'ACTIVE',
      gender: 'FEMALE',
      religion: 'islam',
    },
    names,
    columns: ['roll', 'registration', 'name', 'class', 'status', 'address'],
    academicYear: '2026',
  });

  it('maps every filter onto the STUDENTS fields, by name and not by id', () => {
    const def = plan.build();
    expect(def.subjectArea).toBe(ReportSubjectArea.STUDENTS);
    const byField = Object.fromEntries(def.dataset.filters.map((f) => [f.field, f]));
    expect(byField.class).toEqual({ field: 'class', op: FilterOp.EQ, value: 'Class 8' });
    expect(byField.section).toEqual({ field: 'section', op: FilterOp.EQ, value: 'A' });
    expect(byField.shift).toMatchObject({ op: FilterOp.EQ, value: 'Morning' });
    expect(byField.version).toMatchObject({ op: FilterOp.EQ, value: 'Bangla' });
    expect(byField.status).toMatchObject({ op: FilterOp.EQ, value: 'ACTIVE' });
    expect(byField.gender).toMatchObject({ op: FilterOp.EQ, value: 'FEMALE' });
    expect(JSON.stringify(def)).not.toContain('c1');
  });

  it('matches a religion in any letter case, like the list does', () => {
    const religion = plan.build().dataset.filters.find((f) => f.field === 'religion');
    expect(religion?.op).toBe(FilterOp.IN);
    expect(religion?.value).toEqual(expect.arrayContaining(['islam', 'Islam', 'ISLAM']));
  });

  it('turns the academic year into a prompt, which carries no default so a run picks the current year', () => {
    expect(plan.prompts).toEqual([{ key: 'academic_year', name: 'academicYear', value: '2026' }]);
    const def = plan.build();
    expect(def.parameters).toHaveLength(1);
    expect(def.parameters[0]).toMatchObject({
      key: 'academic_year',
      type: ReportParamType.ACADEMIC_YEAR,
      required: false,
    });
    expect(def.parameters[0]).not.toHaveProperty('default');
    expect(def.dataset.filters[0]).toEqual({
      field: 'academic_year',
      op: FilterOp.EQ,
      value: { param: 'academic_year' },
    });
  });

  it("fixes the year to the list's year when the prompt is switched off", () => {
    const def = plan.build({ academic_year: false });
    expect(def.parameters).toEqual([]);
    expect(def.dataset.filters[0]).toEqual({
      field: 'academic_year',
      op: FilterOp.EQ,
      value: '2026',
    });
  });

  it('shows the visible columns in list order as fields, and says which column has none', () => {
    const def = plan.build();
    expect(def.dataset.dimensions.map((d) => d.field)).toEqual([
      'roll',
      'registration_number',
      'name',
      'class',
      'section',
      'status',
    ]);
    expect(def.dataset.measures).toEqual([]);
    expect(def.layout.type).toBe(ReportLayoutType.TABLE);
    expect(plan.unmappedColumns).toEqual(['address']);
  });

  it('reports a filter the report cannot carry, and an id with no known name', () => {
    const odd = planListReport({
      kind: 'students',
      filters: { search: 'rahim', class_id: 'c1', gender: 'Boy' },
    });
    expect(odd.unmappedFilters).toEqual(['class', 'gender', 'search']);
    expect(odd.build().dataset.filters).toEqual([]);
  });

  it('maps a date of birth range as fixed dates', () => {
    const def = planListReport({
      kind: 'students',
      filters: { date_of_birth_from: '2012-01-01', date_of_birth_to: '2013-12-31' },
    }).build();
    expect(def.dataset.filters).toEqual([
      { field: 'birth_date', op: FilterOp.BETWEEN, value: ['2012-01-01', '2013-12-31'] },
    ]);
  });

  it('falls back to name, class and status when every column is hidden, and goes landscape when wide', () => {
    expect(
      planListReport({ kind: 'students', filters: {}, columns: [] })
        .build()
        .dataset.dimensions.map((d) => d.field),
    ).toEqual(['name', 'class', 'section', 'status']);
    const wide = planListReport({
      kind: 'students',
      filters: {},
      columns: [
        'roll',
        'registration',
        'name',
        'class',
        'guardian',
        'status',
        'dateOfBirth',
        'gender',
      ],
    }).build();
    expect(wide.page.orientation).toBe('landscape');
  });

  it('has no year filter and no prompt when the current year is not known', () => {
    const noYear = planListReport({ kind: 'students', filters: {}, columns: ['name'] });
    expect(noYear.prompts).toEqual([]);
    expect(noYear.build().dataset.filters).toEqual([]);
  });

  it('names the report after the class and section', () => {
    expect(plan.name).toEqual({ scope: 'Class 8 · A', area: 'students' });
  });
});

describe('dues list', () => {
  it('becomes totals per class and section on the FEES area, for open bills only', () => {
    const plan = planListReport({
      kind: 'dues',
      filters: { class_id: 'c8', status: 'PARTIALLY_PAID', fee_type: 'EXAM_FEE' },
      names: { className: 'Class 8' },
      columns: ['student', 'class', 'due', 'status', 'wallet', 'lastReminder'],
    });
    const def = plan.build();
    expect(def.subjectArea).toBe(ReportSubjectArea.FEES);
    expect(def.dataset.dimensions.map((d) => d.field)).toEqual(['class', 'section', 'status']);
    expect(def.dataset.measures.map((m) => m.field)).toEqual(['outstanding']);
    expect(def.dataset.filters).toEqual([
      { field: 'class', op: FilterOp.EQ, value: 'Class 8' },
      { field: 'status', op: FilterOp.EQ, value: 'PARTIALLY_PAID' },
      { field: 'fee_type', op: FilterOp.EQ, value: 'EXAM_FEE' },
    ]);
    expect(def.layout).toMatchObject({ type: ReportLayoutType.GROUPED, group_by: ['class'] });
    expect(plan.unmappedColumns).toEqual(['student', 'wallet', 'lastReminder']);
    expect(plan.name).toEqual({ scope: 'Class 8', area: 'dues' });
  });

  it('keeps paid bills out when no status is chosen', () => {
    const def = planListReport({ kind: 'dues', filters: {}, columns: ['due'] }).build();
    expect(def.dataset.filters).toEqual([
      { field: 'status', op: FilterOp.IN, value: ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'] },
    ]);
  });

  it('maps the overdue-only switch to the late bills, and the money columns to totals', () => {
    const plan = planListReport({
      kind: 'dues',
      filters: { flagged: 'true' },
      columns: ['total', 'paid', 'due'],
    });
    const def = plan.build();
    expect(def.dataset.filters).toEqual([
      { field: 'ageing', op: FilterOp.IN, value: ['D0_30', 'D31_60', 'D61_90', 'D90_PLUS'] },
    ]);
    expect(def.dataset.measures.map((m) => m.field)).toEqual(['billed', 'paid', 'outstanding']);
    expect(plan.name.area).toBe('duesLate');
  });

  it('reports the fee month, year and search as filters that will not go in', () => {
    const plan = planListReport({
      kind: 'dues',
      filters: { month: '3', year: '2026', search: 'x' },
    });
    expect(plan.unmappedFilters).toEqual(['month', 'year', 'search']);
  });
});

describe('payments list', () => {
  it('turns a date range into a prompt that defaults to what the list showed', () => {
    const plan = planListReport({
      kind: 'payments',
      filters: { payment_method: 'BKASH', date_from: '2026-10-01', date_to: '2026-10-31' },
    });
    expect(plan.prompts).toEqual([
      { key: 'date_range', name: 'dateRange', value: { from: '2026-10-01', to: '2026-10-31' } },
    ]);
    const def = plan.build();
    expect(def.subjectArea).toBe(ReportSubjectArea.PAYMENTS);
    expect(def.parameters[0]).toMatchObject({
      key: 'date_range',
      type: ReportParamType.DATE_RANGE,
      default: { from: '2026-10-01', to: '2026-10-31' },
    });
    expect(def.dataset.filters).toEqual([
      { field: 'payment_date', op: FilterOp.BETWEEN, value: { param: 'date_range' } },
      { field: 'method', op: FilterOp.EQ, value: 'BKASH' },
      { field: 'is_reversal', op: FilterOp.EQ, value: false },
    ]);
    expect(def.dataset.measures.map((m) => m.field)).toEqual(['collected', 'payments']);
  });

  it('says that payments the list hides because they were reversed are still counted', () => {
    expect(planListReport({ kind: 'payments', filters: {} }).unmappedFilters).toEqual([
      'reversedHidden',
    ]);
    expect(
      planListReport({ kind: 'payments', filters: { include_reversed: 'true' } }).unmappedFilters,
    ).toEqual([]);
  });

  it('fixes the dates when the prompt is off, and keeps reversals when the list does', () => {
    const def = planListReport({
      kind: 'payments',
      filters: { date_from: '2026-10-01', date_to: '2026-10-31', include_reversed: 'true' },
    }).build({ date_range: false });
    expect(def.parameters).toEqual([]);
    expect(def.dataset.filters).toEqual([
      { field: 'payment_date', op: FilterOp.BETWEEN, value: ['2026-10-01', '2026-10-31'] },
    ]);
    expect(def.dataset.measures.map((m) => m.field)).toEqual([
      'collected',
      'reversed',
      'net',
      'payments',
    ]);
  });

  it('keeps one open end as a fixed filter, with no prompt', () => {
    const plan = planListReport({ kind: 'payments', filters: { date_from: '2026-10-01' } });
    expect(plan.prompts).toEqual([]);
    expect(plan.build().dataset.filters[0]).toEqual({
      field: 'payment_date',
      op: FilterOp.GTE,
      value: '2026-10-01',
    });
  });

  it('reports search as a filter that will not go in, and a bad date', () => {
    const plan = planListReport({
      kind: 'payments',
      filters: { search: 'r1', date_from: 'yesterday' },
    });
    expect(plan.unmappedFilters).toEqual(['reversedHidden', 'search', 'date']);
    expect(plan.unmappedColumns).toEqual(['student', 'reference']);
  });
});

describe('readVisibleColumns', () => {
  afterEach(() => window.localStorage.clear());
  const all = ['roll', 'name', 'address'];

  it('follows the page defaults when nothing is stored', () => {
    expect(readVisibleColumns('students-list', all, { address: false })).toEqual(['roll', 'name']);
  });

  it('follows what the person chose, and the order they set', () => {
    window.localStorage.setItem(
      'data-table:students-list',
      JSON.stringify({
        columnVisibility: { roll: false, address: true },
        columnOrder: ['address'],
      }),
    );
    expect(readVisibleColumns('students-list', all, { address: false })).toEqual([
      'address',
      'name',
    ]);
  });

  it('falls back to the defaults on corrupt storage', () => {
    window.localStorage.setItem('data-table:students-list', '{not json');
    expect(readVisibleColumns('students-list', all, { address: false })).toEqual(['roll', 'name']);
  });
});
