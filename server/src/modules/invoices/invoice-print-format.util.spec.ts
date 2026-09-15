import { describe, it, expect } from 'vitest';
import { InvoiceKind } from '@biddaloy/shared';
import { Invoice, InvoiceSnapshot } from './entities/invoice.entity';
import {
  escapeHtml,
  formatAmount,
  formatDate,
  signedAmount,
  isCreditNote,
  filterSnapshotForLinkedStudents,
} from './invoice-print-format.util';

function makeInvoice(kind: InvoiceKind): Invoice {
  return { kind } as Invoice;
}

function makeSnapshot(): InvoiceSnapshot {
  return {
    issuer: {} as InvoiceSnapshot['issuer'],
    students: [
      {
        id: 's1',
        full_name: 'Student One',
        registration_number: 'REG-1',
        class_name: null,
        lines: [],
      },
      {
        id: 's2',
        full_name: 'Student Two',
        registration_number: 'REG-2',
        class_name: null,
        lines: [],
      },
    ],
    totals: { billed: 0, discount: 0, paid: 0, change: 0, wallet_used: 0, wallet_added: 0 },
    payment: {
      method: 'CASH' as any,
      reference: null,
      received_by_name: null,
      payment_date: '2026-01-01',
    },
  };
}

describe('escapeHtml', () => {
  it('escapes the five HTML-sensitive characters', () => {
    expect(escapeHtml(`<b>"a" & 'b'</b>`)).toBe(
      '&lt;b&gt;&quot;a&quot; &amp; &#39;b&#39;&lt;/b&gt;',
    );
  });

  it('renders null/undefined as an empty string', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });
});

describe('formatDate', () => {
  it('renders day/short-month/year', () => {
    expect(formatDate('2026-09-10')).toBe('10 Sept 2026');
  });
});

describe('formatAmount', () => {
  it('renders two decimals grouped, in Bengali digits by default', () => {
    expect(formatAmount(4200)).toBe('৪,২০০.০০');
  });

  it('keeps the sign on a negative (credit-note) amount', () => {
    expect(formatAmount(-900)).toBe('-৯০০.০০');
  });

  it('accepts a numeric string', () => {
    expect(formatAmount('750')).toBe('৭৫০.০০');
  });
});

describe('signedAmount / isCreditNote', () => {
  it('leaves an ordinary invoice amount untouched', () => {
    expect(signedAmount(900, makeInvoice(InvoiceKind.INVOICE))).toBe(900);
    expect(isCreditNote(makeInvoice(InvoiceKind.INVOICE))).toBe(false);
  });

  it('negates a credit note amount even if the stored snapshot value is positive', () => {
    expect(signedAmount(900, makeInvoice(InvoiceKind.CREDIT_NOTE))).toBe(-900);
    expect(isCreditNote(makeInvoice(InvoiceKind.CREDIT_NOTE))).toBe(true);
  });

  it('does not double-negate an already-negative value', () => {
    expect(signedAmount(-900, makeInvoice(InvoiceKind.CREDIT_NOTE))).toBe(-900);
  });
});

describe('filterSnapshotForLinkedStudents', () => {
  it('returns the snapshot unchanged when linkedStudentIds is undefined (staff/admin)', () => {
    const snapshot = makeSnapshot();
    expect(filterSnapshotForLinkedStudents(snapshot, undefined)).toBe(snapshot);
  });

  it('filters students down to only the linked ids', () => {
    const snapshot = makeSnapshot();
    const filtered = filterSnapshotForLinkedStudents(snapshot, ['s1']);
    expect(filtered.students).toHaveLength(1);
    expect(filtered.students[0].id).toBe('s1');
    expect(filtered.students.map((s) => s.full_name)).not.toContain('Student Two');
  });

  it('returns an empty students array when linked to none of them', () => {
    const snapshot = makeSnapshot();
    const filtered = filterSnapshotForLinkedStudents(snapshot, ['unrelated-id']);
    expect(filtered.students).toHaveLength(0);
  });

  it('recomputes billed/discount/paid from only the linked student(s) lines, and zeroes the whole-payment fields, on a partial (dropped-sibling) view', () => {
    const snapshot = makeSnapshot();
    snapshot.students[0].lines = [
      {
        fee_name: 'Tuition',
        period_label: 'Jan 2026',
        amount: 500,
        discount: 50,
        paid_this_time: 450,
        balance_after: 0,
      },
    ];
    snapshot.students[1].lines = [
      {
        fee_name: 'Tuition',
        period_label: 'Jan 2026',
        amount: 800,
        discount: 0,
        paid_this_time: 800,
        balance_after: 0,
      },
    ];
    snapshot.totals = {
      billed: 1300,
      discount: 50,
      paid: 1250,
      change: 20,
      wallet_used: 30,
      wallet_added: 40,
    };

    // Guardian linked only to s1 (not the primary/other sibling s2).
    const filtered = filterSnapshotForLinkedStudents(snapshot, ['s1']);

    expect(filtered.totals).toEqual({
      billed: 500,
      discount: 50,
      paid: 450,
      change: 0,
      wallet_used: 0,
      wallet_added: 0,
    });
  });

  it('leaves totals exactly as stored when linked to every student on the invoice (not a partial view)', () => {
    const snapshot = makeSnapshot();
    snapshot.totals = {
      billed: 1300,
      discount: 50,
      paid: 1250,
      change: 20,
      wallet_used: 30,
      wallet_added: 40,
    };

    // Linked to both s1 and s2 — this must NOT recompute `paid` from line
    // sums, since `snapshot.totals.paid` (= payment.total_amount) can
    // legitimately differ from sum(paid_this_time) when the payment
    // overpays onto wallet credit.
    const filtered = filterSnapshotForLinkedStudents(snapshot, ['s1', 's2']);

    expect(filtered.totals).toEqual(snapshot.totals);
  });
});
