import { describe, expect, it } from 'vitest';
import { PaymentMethod, PaymentStatus } from '@biddaloy/shared';
import { paymentsTab, type PaymentRow } from './payments.tab';
import { Payment } from '../../../fees/entities/payment.entity';
import type { ExportContext, ImportContext, RowError } from '../../codec/tab-spec';

function fakeImportCtx(
  refs: Record<string, Record<string, string>>,
  onWarn?: (e: RowError) => void,
): ImportContext {
  return {
    tenantId: 'tenant-1',
    ref: (tab, key) => refs[tab]?.[key],
    warn: (e) => onWarn?.(e),
  };
}

function fakeExportCtx(keys: Record<string, Record<string, string>>): ExportContext {
  return { keyOf: (tab, id) => keys[tab]?.[id] ?? '' };
}

function cellsFor(row: PaymentRow): Record<string, string> {
  return {
    id: row.id,
    student: row.student_key,
    total_amount: row.total_amount,
    payment_method: row.payment_method,
    payment_status: row.payment_status,
    transaction_reference: row.transaction_reference ?? '',
    remarks: row.remarks ?? '',
    received_by: row.received_by_key ?? '',
    invoice: row.invoice_key ?? '',
    payment_date: row.payment_date,
  };
}

describe('paymentsTab', () => {
  it('round-trips fromRow(toRow-shaped cells)', () => {
    const row: PaymentRow = {
      id: '00000000-0000-4000-8000-000000000001',
      student_id: 'student-1',
      student_key: 'REG-001',
      total_amount: '1500.00',
      payment_method: PaymentMethod.CASH,
      payment_status: PaymentStatus.SUCCESS,
      transaction_reference: 'TXN-001',
      remarks: 'Paid in full',
      received_by_id: 'user-1',
      received_by_key: 'admin@example.com',
      invoice_id: 'invoice-1',
      invoice_key: 'INV-2026-00001',
      payment_date: '2026-01-05T10:00:00.000Z',
    };
    const ctx = fakeImportCtx({
      students: { 'REG-001': 'student-1' },
      users: { 'admin@example.com': 'user-1' },
      invoices: { 'INV-2026-00001': 'invoice-1' },
    });
    const result = paymentsTab.fromRow(cellsFor(row), 2, ctx);
    expect('row' in result).toBe(true);
    expect((result as { row: PaymentRow }).row).toEqual(row);
  });

  it('keyOf uses transaction_reference when present', () => {
    const row = { transaction_reference: 'TXN-001' } as PaymentRow;
    expect(paymentsTab.keyOf(row)).toBe('TXN-001');
  });

  it('keyOf falls back to student|date|amount|method and warns when the reference is empty', () => {
    const warnings: RowError[] = [];
    const row: PaymentRow = {
      id: '00000000-0000-4000-8000-000000000001',
      student_id: 'student-1',
      student_key: 'REG-001',
      total_amount: '1500.00',
      payment_method: PaymentMethod.CASH,
      payment_status: PaymentStatus.SUCCESS,
      transaction_reference: '',
      remarks: null,
      received_by_id: null,
      received_by_key: null,
      invoice_id: null,
      invoice_key: null,
      payment_date: '2026-01-05T10:00:00.000Z',
    };
    const ctx = fakeImportCtx({ students: { 'REG-001': 'student-1' } }, (e) => warnings.push(e));
    const result = paymentsTab.fromRow(cellsFor(row), 2, ctx);
    expect('row' in result).toBe(true);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toMatch(/weaker fallback key/);
    const built = (result as { row: PaymentRow }).row;
    expect(paymentsTab.keyOf(built)).toBe('REG-001|2026-01-05T10:00:00.000Z|1500.00|CASH');
  });

  it('keyOf(entity) and keyOf(row) build the same fallback key from the same student', () => {
    const entity = new Payment();
    entity.transaction_reference = null;
    entity.student = { registration_number: 'REG-001' } as Payment['student'];
    // A real `Date`, because that is what node-postgres hands back for a
    // `timestamptz` column. Asserting against a pre-formatted ISO *string*
    // here hid a bug where the entity branch interpolated the `Date`
    // directly and produced locale text ("Mon Jan 05 2026 16:00:00 GMT+0600
    // …"), which never matched the row's ISO text.
    entity.payment_date = new Date('2026-01-05T10:00:00.000Z');
    entity.total_amount = '1500.00' as unknown as number;
    entity.payment_method = PaymentMethod.CASH;

    const row: PaymentRow = {
      id: '00000000-0000-4000-8000-000000000001',
      student_id: 'student-1',
      student_key: 'REG-001',
      total_amount: '1500.00',
      payment_method: PaymentMethod.CASH,
      payment_status: PaymentStatus.SUCCESS,
      transaction_reference: null,
      remarks: null,
      received_by_id: null,
      received_by_key: null,
      invoice_id: null,
      invoice_key: null,
      payment_date: '2026-01-05T10:00:00.000Z',
    };

    // Both branches must resolve to the same text so a re-imported row
    // matches its existing DB row instead of duplicating it — the exact bug
    // this test guards: an earlier version used the raw student uuid on the
    // entity branch and the registration_number on the row branch.
    expect(paymentsTab.keyOf(entity)).toBe('REG-001|2026-01-05T10:00:00.000Z|1500.00|CASH');
    expect(paymentsTab.keyOf(entity)).toBe(paymentsTab.keyOf(row));
  });

  it('exports refs via ctx.keyOf, never raw ids', () => {
    const entity = {
      id: 'p-1',
      student_id: 'student-1',
      total_amount: '1500.00',
      payment_method: PaymentMethod.CASH,
      payment_status: PaymentStatus.SUCCESS,
      transaction_reference: 'TXN-001',
      remarks: null,
      received_by_user_id: 'user-1',
      invoice_id: 'invoice-1',
      payment_date: '2026-01-05T10:00:00.000Z',
    } as any;
    const ctx = fakeExportCtx({
      students: { 'student-1': 'REG-001' },
      users: { 'user-1': 'admin@example.com' },
      invoices: { 'invoice-1': 'INV-2026-00001' },
    });
    const out = paymentsTab.toRow(entity, ctx);
    expect(out.student).toBe('REG-001');
    expect(out.received_by).toBe('admin@example.com');
    expect(out.invoice).toBe('INV-2026-00001');
  });
});
