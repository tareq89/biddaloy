import { describe, expect, it } from 'vitest';
import { InvoiceKind, InvoiceStatus } from '@biddaloy/shared';
import { Invoice } from '../../../invoices/entities/invoice.entity';
import { invoicesTab, type InvoiceRow } from './invoices.tab';
import type { ExportContext, ImportContext } from '../../codec/tab-spec';

const VALID_SNAPSHOT = {
  issuer: { name: 'Test School', captured_at: '2026-01-05T00:00:00.000Z' },
  students: [],
  totals: { billed: 1500, discount: 0, paid: 1500, change: 0, wallet_used: 0, wallet_added: 0 },
  payment: {
    method: 'CASH',
    reference: null,
    received_by_name: null,
    payment_date: '2026-01-05',
  },
};

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
    kind: row.kind,
    student: row.student_key,
    total_amount: row.total_amount,
    tax_amount: row.tax_amount,
    discount_amount: row.discount_amount,
    status: row.status,
    issued_date: row.issued_date,
    due_date: row.due_date,
    snapshot: JSON.stringify(row.snapshot ?? {}),
    issued_by: row.issued_by_key ?? '',
    notes: row.notes ?? '',
  };
}

describe('invoicesTab', () => {
  it('round-trips fromRow(toRow-shaped cells)', () => {
    const row: InvoiceRow = {
      id: '00000000-0000-4000-8000-000000000001',
      invoice_number: 'INV-2026-00001',
      kind: InvoiceKind.INVOICE,
      student_id: 'student-1',
      student_key: 'REG-001',
      total_amount: '1500.00',
      tax_amount: '0.00',
      discount_amount: '0.00',
      status: InvoiceStatus.ISSUED,
      issued_date: '2026-01-05',
      due_date: '2026-01-15',
      snapshot: VALID_SNAPSHOT,
      issued_by_id: 'user-1',
      issued_by_key: 'admin@example.com',
      notes: 'First invoice',
    };
    const ctx = fakeImportCtx({
      students: { 'REG-001': 'student-1' },
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
      kind: InvoiceKind.INVOICE,
      student_id: '',
      student_key: 'REG-999',
      total_amount: '1500.00',
      tax_amount: '0.00',
      discount_amount: '0.00',
      status: InvoiceStatus.ISSUED,
      issued_date: '2026-01-05',
      due_date: '2026-01-15',
      snapshot: VALID_SNAPSHOT,
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

  it('never exports a raw uuid for student/issued_by', () => {
    const entity = {
      id: 'inv-1',
      invoice_number: 'INV-2026-00001',
      kind: InvoiceKind.INVOICE,
      student_id: 'student-1',
      total_amount: '1500.00',
      tax_amount: '0.00',
      discount_amount: '0.00',
      status: InvoiceStatus.ISSUED,
      issued_date: '2026-01-05',
      due_date: '2026-01-15',
      snapshot: null,
      issued_by_user_id: 'user-1',
      notes: null,
    } as any;
    const ctx = fakeExportCtx({
      students: { 'student-1': 'REG-001' },
      users: { 'user-1': 'admin@example.com' },
    });
    const out = invoicesTab.toRow(entity, ctx);
    expect(out.student).toBe('REG-001');
    expect(out.issued_by).toBe('admin@example.com');
    expect(Object.values(out)).not.toContain('student-1');
    expect(Object.values(out)).not.toContain('user-1');
  });

  it('reports no date change when the row matches the entity (real Date columns)', () => {
    // `issued_date`/`due_date` are `date` columns — a `Date` on the entity,
    // `YYYY-MM-DD` text on the row. `String(...)` on both sides never
    // matches, so every invoice showed as modified in a restore preview.
    const entity = Object.assign(new Invoice(), {
      invoice_number: 'INV-2026-00042',
      kind: InvoiceKind.INVOICE,
      student_id: 'student-1',
      total_amount: '1500.00',
      tax_amount: '0.00',
      discount_amount: '0.00',
      status: InvoiceStatus.ISSUED,
      issued_date: new Date(2026, 0, 3),
      due_date: new Date(2026, 0, 10),
      snapshot: null,
      issued_by_user_id: null,
      notes: null,
    }) as Invoice;

    const row = {
      invoice_number: 'INV-2026-00042',
      kind: InvoiceKind.INVOICE,
      student_id: 'student-1',
      total_amount: '1500.00',
      tax_amount: '0.00',
      discount_amount: '0.00',
      status: InvoiceStatus.ISSUED,
      issued_date: '2026-01-03',
      due_date: '2026-01-10',
      snapshot: null,
      issued_by_id: null,
      notes: null,
    } as unknown as InvoiceRow;

    expect(invoicesTab.diffFields(row, entity)).toEqual([]);
  });

  it("keeps an existing DRAFT invoice's issuer_snapshot on a same-school restore", async () => {
    // The snapshot is the issuer identity frozen at issue time. Nulling it
    // on update would silently repoint every reprinted receipt at the
    // school's *current* profile — and because `issuer_snapshot` is in
    // `excluded`, `diffFields` would never surface the change.
    const frozen = { school_name: 'Old Name' } as unknown as Invoice['issuer_snapshot'];
    const existing = Object.assign(new Invoice(), {
      id: 'inv-1',
      status: InvoiceStatus.DRAFT,
      issuer_snapshot: frozen,
    }) as Invoice;

    const saved: Invoice[] = [];
    const manager = {
      save: (_e: unknown, v: Invoice) => {
        saved.push(v);
        return Promise.resolve(v);
      },
    };

    const row = {
      id: 'inv-1',
      invoice_number: 'INV-2026-00042',
      kind: InvoiceKind.INVOICE,
      student_id: 'student-1',
      total_amount: '1500.00',
      tax_amount: '0.00',
      discount_amount: '0.00',
      status: InvoiceStatus.DRAFT,
      issued_date: '2026-01-03',
      due_date: '2026-01-10',
      snapshot: null,
      issued_by_id: null,
      notes: null,
    } as unknown as InvoiceRow;

    await invoicesTab.upsert(row, existing, 'tenant-1', manager as never);
    expect(saved[0].issuer_snapshot).toBe(frozen);

    // A brand-new invoice still gets a null snapshot (D9 of #508).
    await invoicesTab.upsert(row, null, 'tenant-1', manager as never);
    expect(saved[1].issuer_snapshot).toBeNull();
  });

  it('only touches status/updated_at/deleted_at once an invoice has left DRAFT', async () => {
    // [16.5.1] D21 immutability trigger: any other column change on an
    // ISSUED (or later) row is rejected by the DB. A restore must not even
    // attempt a full-column write on one of these.
    const existing = Object.assign(new Invoice(), {
      id: 'inv-1',
      invoice_number: 'INV-2026-00042',
      kind: InvoiceKind.INVOICE,
      student_id: 'student-1',
      total_amount: '1500.00',
      status: InvoiceStatus.ISSUED,
      snapshot: { totals: { billed: 1500 } },
      issuer_snapshot: { school_name: 'Original' } as unknown as Invoice['issuer_snapshot'],
    }) as Invoice;

    const saved: Invoice[] = [];
    const manager = {
      save: (_e: unknown, v: Invoice) => {
        saved.push(v);
        return Promise.resolve(v);
      },
    };

    // The row claims a different student/amount/snapshot than what's on
    // disk (e.g. a stale export re-imported) — none of that may land.
    const row = {
      id: 'inv-1',
      invoice_number: 'INV-2026-00042',
      kind: InvoiceKind.CREDIT_NOTE,
      student_id: 'student-2',
      total_amount: '9999.00',
      tax_amount: '0.00',
      discount_amount: '0.00',
      status: InvoiceStatus.CANCELLED,
      issued_date: '2026-01-03',
      due_date: '2026-01-10',
      snapshot: { totals: { billed: 9999 } },
      issued_by_id: null,
      notes: 'tampered',
    } as unknown as InvoiceRow;

    await invoicesTab.upsert(row, existing, 'tenant-1', manager as never);

    expect(saved).toHaveLength(1);
    expect(saved[0].status).toBe(InvoiceStatus.CANCELLED);
    expect(saved[0].student_id).toBe('student-1');
    expect(saved[0].total_amount).toBe('1500.00');
    expect(saved[0].snapshot).toEqual({ totals: { billed: 1500 } });
    expect(saved[0].kind).toBe(InvoiceKind.INVOICE);
  });

  it('rejects a restore row that tries to re-enter DRAFT on an already-issued invoice', async () => {
    // [16.5.1 fix] The trigger lets `status` change freely once a row has
    // left DRAFT — it does not stop status from going *back* to DRAFT. A
    // stale export re-imported over an already-ISSUED invoice must not be
    // allowed to resurrect it as a draft.
    const existing = Object.assign(new Invoice(), {
      id: 'inv-1',
      invoice_number: 'INV-2026-00042',
      kind: InvoiceKind.INVOICE,
      student_id: 'student-1',
      total_amount: '1500.00',
      status: InvoiceStatus.ISSUED,
      snapshot: { totals: { billed: 1500 } },
    }) as Invoice;

    const saved: Invoice[] = [];
    const manager = {
      save: (_e: unknown, v: Invoice) => {
        saved.push(v);
        return Promise.resolve(v);
      },
    };

    const row = {
      id: 'inv-1',
      invoice_number: 'INV-2026-00042',
      kind: InvoiceKind.INVOICE,
      student_id: 'student-1',
      total_amount: '1500.00',
      tax_amount: '0.00',
      discount_amount: '0.00',
      status: InvoiceStatus.DRAFT,
      issued_date: '2026-01-03',
      due_date: '2026-01-10',
      snapshot: { totals: { billed: 1500 } },
      issued_by_id: null,
      notes: null,
    } as unknown as InvoiceRow;

    await expect(invoicesTab.upsert(row, existing, 'tenant-1', manager as never)).rejects.toThrow(
      /already ISSUED/,
    );
    expect(saved).toHaveLength(0);
  });
});
