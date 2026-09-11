import { describe, expect, it } from 'vitest';
import { PaymentAllocationType } from '@biddaloy/shared';
import { paymentAllocationsTab, type PaymentAllocationRow } from './payment-allocations.tab';
import type { ExportContext, ImportContext } from '../../codec/tab-spec';

function fakeImportCtx(refs: Record<string, Record<string, string>>): ImportContext {
  return { tenantId: 'tenant-1', ref: (tab, key) => refs[tab]?.[key], warn: () => undefined };
}

function fakeExportCtx(keys: Record<string, Record<string, string>>): ExportContext {
  return { keyOf: (tab, id) => keys[tab]?.[id] ?? '' };
}

function cellsFor(row: PaymentAllocationRow): Record<string, string> {
  return {
    id: row.id,
    payment: row.payment_key,
    student_fee: row.student_fee_key,
    allocated_amount: row.allocated_amount,
    allocation_type: row.allocation_type,
    notes: row.notes ?? '',
  };
}

describe('paymentAllocationsTab', () => {
  it('round-trips fromRow(toRow-shaped cells)', () => {
    const row: PaymentAllocationRow = {
      id: '00000000-0000-4000-8000-000000000001',
      payment_id: 'payment-1',
      payment_key: 'TXN-001',
      student_fee_id: 'fee-1',
      student_fee_key: 'REG-001|2026-2027|1|2026',
      allocated_amount: '500.00',
      allocation_type: PaymentAllocationType.CURRENT,
      notes: 'Partial',
    };
    const ctx = fakeImportCtx({
      payments: { 'TXN-001': 'payment-1' },
      student_fees: { 'REG-001|2026-2027|1|2026': 'fee-1' },
    });
    const result = paymentAllocationsTab.fromRow(cellsFor(row), 2, ctx);
    expect('row' in result).toBe(true);
    expect((result as { row: PaymentAllocationRow }).row).toEqual(row);
  });

  it('keyOf joins payment and student_fee keys', () => {
    const row = {
      payment_key: 'TXN-001',
      student_fee_key: 'REG-001|2026-2027|1|2026',
    } as PaymentAllocationRow;
    expect(paymentAllocationsTab.keyOf(row)).toBe('TXN-001|REG-001|2026-2027|1|2026');
  });

  it('exports refs via ctx.keyOf, never raw ids', () => {
    const entity = {
      id: 'a-1',
      payment_id: 'payment-1',
      student_fee_id: 'fee-1',
      allocated_amount: '500.00',
      allocation_type: PaymentAllocationType.CURRENT,
      notes: null,
    } as any;
    const ctx = fakeExportCtx({
      payments: { 'payment-1': 'TXN-001' },
      student_fees: { 'fee-1': 'REG-001|2026-2027|1|2026' },
    });
    const out = paymentAllocationsTab.toRow(entity, ctx);
    expect(out.payment).toBe('TXN-001');
    expect(out.student_fee).toBe('REG-001|2026-2027|1|2026');
  });
});
