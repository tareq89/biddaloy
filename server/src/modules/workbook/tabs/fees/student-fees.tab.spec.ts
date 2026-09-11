import { describe, expect, it } from 'vitest';
import { FeeStatus } from '@biddaloy/shared';
import { StudentFee } from '../../../fees/entities/student-fee.entity';
import { studentFeesTab, type StudentFeeRow } from './student-fees.tab';
import type { ExportContext, ImportContext } from '../../codec/tab-spec';

function fakeImportCtx(refs: Record<string, Record<string, string>>): ImportContext {
  return {
    tenantId: 'tenant-1',
    ref: (tab, key) => refs[tab]?.[key],
    warn: () => undefined,
  };
}

function fakeExportCtx(keys: Record<string, Record<string, string>>): ExportContext {
  return { keyOf: (tab, id) => keys[tab]?.[id] ?? '' };
}

function cellsFor(row: StudentFeeRow): Record<string, string> {
  return {
    id: row.id,
    student: row.student_key,
    academic_year: row.academic_year_key,
    month: String(row.month),
    year: String(row.year),
    total_amount: row.total_amount,
    paid_amount: row.paid_amount,
    discount_amount: row.discount_amount,
    status: row.status,
    due_date: row.due_date ?? '',
    reminder_threshold_date: row.reminder_threshold_date ?? '',
    is_advance_payment: row.is_advance_payment ? 'TRUE' : 'FALSE',
    original_advance_month: row.original_advance_month ? String(row.original_advance_month) : '',
    original_advance_year: row.original_advance_year ? String(row.original_advance_year) : '',
  };
}

describe('studentFeesTab', () => {
  it('round-trips fromRow(toRow-shaped cells)', () => {
    const row: StudentFeeRow = {
      id: '00000000-0000-4000-8000-000000000001',
      student_id: 'student-1',
      student_key: 'REG-001',
      academic_year_id: 'year-1',
      academic_year_key: '2026-2027',
      month: 1,
      year: 2026,
      total_amount: '1500.00',
      paid_amount: '0.00',
      discount_amount: '0.00',
      status: FeeStatus.PENDING,
      due_date: '2026-01-10',
      reminder_threshold_date: '2026-01-05',
      is_advance_payment: false,
      original_advance_month: null,
      original_advance_year: null,
    };
    const ctx = fakeImportCtx({
      students: { 'REG-001': 'student-1' },
      academic_years: { '2026-2027': 'year-1' },
    });
    const result = studentFeesTab.fromRow(cellsFor(row), 2, ctx);
    expect('row' in result).toBe(true);
    expect((result as { row: StudentFeeRow }).row).toEqual(row);
  });

  it('errors when the student key does not resolve', () => {
    const row: StudentFeeRow = {
      id: '00000000-0000-4000-8000-000000000001',
      student_id: '',
      student_key: 'REG-999',
      academic_year_id: 'year-1',
      academic_year_key: '2026-2027',
      month: 1,
      year: 2026,
      total_amount: '1500.00',
      paid_amount: '0.00',
      discount_amount: '0.00',
      status: FeeStatus.PENDING,
      due_date: null,
      reminder_threshold_date: null,
      is_advance_payment: false,
      original_advance_month: null,
      original_advance_year: null,
    };
    const ctx = fakeImportCtx({ academic_years: { '2026-2027': 'year-1' } });
    const result = studentFeesTab.fromRow(cellsFor(row), 2, ctx);
    expect('errors' in result).toBe(true);
    expect((result as { errors: { column: string | null }[] }).errors[0].column).toBe('student');
  });

  it('exports the student ref via ctx.keyOf, never a raw id', () => {
    const entity = {
      id: 'sf-1',
      student_id: 'student-1',
      academic_year_id: 'year-1',
      month: 1,
      year: 2026,
      total_amount: '1500.00',
      paid_amount: '0.00',
      discount_amount: '0.00',
      status: FeeStatus.PENDING,
      due_date: null,
      reminder_threshold_date: null,
      is_advance_payment: false,
      original_advance_month: null,
      original_advance_year: null,
    } as any;
    const ctx = fakeExportCtx({
      students: { 'student-1': 'REG-001' },
      academic_years: { 'year-1': '2026-2027' },
    });
    const out = studentFeesTab.toRow(entity, ctx);
    expect(out.student).toBe('REG-001');
    expect(out.student).not.toBe('student-1');
  });

  it('reports no date change when the row matches the entity (real Date columns)', () => {
    // `due_date`/`reminder_threshold_date` are `date` columns: node-postgres
    // hands them back as `Date`, while the row carries `YYYY-MM-DD` text.
    // Comparing them with `String(...)` on both sides never matches, which
    // marked every row of every restore as modified.
    const entity = Object.assign(new StudentFee(), {
      student_id: 'student-1',
      academic_year_id: 'year-1',
      month: 1,
      year: 2026,
      total_amount: '1500.00',
      paid_amount: '0.00',
      discount_amount: '0.00',
      status: FeeStatus.PENDING,
      due_date: new Date(2026, 0, 10),
      reminder_threshold_date: new Date(2026, 0, 5),
      is_advance_payment: false,
      original_advance_month: null,
      original_advance_year: null,
    }) as StudentFee;

    const row = {
      student_id: 'student-1',
      academic_year_id: 'year-1',
      month: 1,
      year: 2026,
      total_amount: '1500.00',
      paid_amount: '0.00',
      discount_amount: '0.00',
      status: FeeStatus.PENDING,
      due_date: '2026-01-10',
      reminder_threshold_date: '2026-01-05',
      is_advance_payment: false,
      original_advance_month: null,
      original_advance_year: null,
    } as StudentFeeRow;

    expect(studentFeesTab.diffFields(row, entity)).toEqual([]);
  });

  it('still reports a genuinely changed due_date', () => {
    const entity = Object.assign(new StudentFee(), {
      due_date: new Date(2026, 0, 10),
      reminder_threshold_date: null,
    }) as StudentFee;
    const row = { due_date: '2026-02-10', reminder_threshold_date: null } as StudentFeeRow;

    expect(studentFeesTab.diffFields(row, entity)).toContain('due_date');
  });
});
