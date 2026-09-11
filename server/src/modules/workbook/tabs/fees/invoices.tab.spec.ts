import { describe, expect, it } from 'vitest';
import { InvoiceStatus } from '@biddaloy/shared';
import { invoicesTab, type InvoiceRow } from './invoices.tab';
import type { ExportContext, ImportContext } from '../../codec/tab-spec';

function fakeImportCtx(refs: Record<string, Record<string, string>>): ImportContext {
  return { tenantId: 'tenant-1', ref: (tab, key) => refs[tab]?.[key], warn: () => undefined };
}

function fakeExportCtx(keys: Record<string, Record<string, string>>): ExportContext {
  return { keyOf: (tab, id) => keys[tab]?.[id] ?? '' };
}

function cellsFor(row: InvoiceRow): Record<string, string> {
  return {
    id: row.id,
    invoice_number: row.invoice_number,
    student: row.student_key,
    student_fee: row.student_fee_key ?? '',
    total_amount: row.total_amount,
    tax_amount: row.tax_amount,
    discount_amount: row.discount_amount,
    status: row.status,
    issued_date: row.issued_date,
    due_date: row.due_date,
    line_items: JSON.stringify(row.line_items ?? []),
    issued_by: row.issued_by_key ?? '',
    notes: row.notes ?? '',
  };
}

describe('invoicesTab', () => {
  it('round-trips fromRow(toRow-shaped cells)', () => {
    const row: InvoiceRow = {
      id: '00000000-0000-4000-8000-000000000001',
      invoice_number: 'INV-2026-00001',
      student_id: 'student-1',
      student_key: 'REG-001',
      student_fee_id: 'fee-1',
      student_fee_key: 'REG-001|2026-2027|1|2026',
      total_amount: '1500.00',
      tax_amount: '0.00',
      discount_amount: '0.00',
      status: InvoiceStatus.ISSUED,
      issued_date: '2026-01-05',
      due_date: '2026-01-15',
      line_items: [{ description: 'Tuition', amount: 1500, quantity: 1, total: 1500 }],
      issued_by_id: 'user-1',
      issued_by_key: 'admin@example.com',
      notes: 'First invoice',
    };
    const ctx = fakeImportCtx({
      students: { 'REG-001': 'student-1' },
      student_fees: { 'REG-001|2026-2027|1|2026': 'fee-1' },
      users: { 'admin@example.com': 'user-1' },
    });
    const result = invoicesTab.fromRow(cellsFor(row), 2, ctx);
    expect('row' in result).toBe(true);
    expect((result as { row: InvoiceRow }).row).toEqual(row);
  });

  it('errors with a RowError naming the column and the key when a ref misses', () => {
    const row: InvoiceRow = {
      id: '00000000-0000-4000-8000-000000000001',
      invoice_number: 'INV-2026-00001',
      student_id: '',
      student_key: 'REG-999',
      student_fee_id: null,
      student_fee_key: null,
      total_amount: '1500.00',
      tax_amount: '0.00',
      discount_amount: '0.00',
      status: InvoiceStatus.ISSUED,
      issued_date: '2026-01-05',
      due_date: '2026-01-15',
      line_items: null,
      issued_by_id: null,
      issued_by_key: null,
      notes: null,
    };
    const ctx = fakeImportCtx({});
    const result = invoicesTab.fromRow(cellsFor(row), 2, ctx);
    expect('errors' in result).toBe(true);
    const errors = (result as { errors: { column: string | null; value?: string }[] }).errors;
    expect(errors[0]).toMatchObject({ column: 'student', value: 'REG-999' });
  });

  it('keyOf is the invoice_number', () => {
    const row = { invoice_number: 'INV-2026-00001' } as InvoiceRow;
    expect(invoicesTab.keyOf(row)).toBe('INV-2026-00001');
  });

  it('never exports a raw uuid for student/student_fee/issued_by', () => {
    const entity = {
      id: 'inv-1',
      invoice_number: 'INV-2026-00001',
      student_id: 'student-1',
      student_fee_id: 'fee-1',
      total_amount: '1500.00',
      tax_amount: '0.00',
      discount_amount: '0.00',
      status: InvoiceStatus.ISSUED,
      issued_date: '2026-01-05',
      due_date: '2026-01-15',
      line_items: null,
      issued_by_user_id: 'user-1',
      notes: null,
    } as any;
    const ctx = fakeExportCtx({
      students: { 'student-1': 'REG-001' },
      student_fees: { 'fee-1': 'REG-001|2026-2027|1|2026' },
      users: { 'user-1': 'admin@example.com' },
    });
    const out = invoicesTab.toRow(entity, ctx);
    expect(out.student).toBe('REG-001');
    expect(out.student_fee).toBe('REG-001|2026-2027|1|2026');
    expect(out.issued_by).toBe('admin@example.com');
    expect(Object.values(out)).not.toContain('student-1');
    expect(Object.values(out)).not.toContain('user-1');
  });
});
