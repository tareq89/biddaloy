import { describe, it, expect } from 'vitest';
import {
  amountInWords,
  InvoiceKind,
  InvoiceStatus,
  PaymentMethod,
  PaymentStatus,
} from '@biddaloy/shared';
import { renderInvoiceHtml } from './invoice-print.template';
import { Invoice } from './entities/invoice.entity';
import { Payment } from '../fees/entities/payment.entity';
import { IssuerSnapshot } from '../schools/profile/issuer-snapshot';

const issuer: IssuerSnapshot = {
  name: 'Sunrise School',
  name_bn: 'সানরাইজ স্কুল',
  address: '12 Main Road',
  phone: '01700000000',
  email: 'info@sunrise.example',
  registration_id: 'EIIN-123',
  logo_key: null,
  captured_at: '2026-01-01T00:00:00.000Z',
};

function makeInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: 'inv-1',
    invoice_number: 'INV-2026-00001',
    kind: InvoiceKind.INVOICE,
    student: {
      full_name: 'Rahim Uddin',
      registration_number: 'REG-0001',
      roll_number: 3,
      class_section: { class: { name: 'Class One' }, section_name: 'A' },
    } as Invoice['student'],
    student_id: 'student-1',
    payment_id: 'payment-1',
    related_invoice_id: null,
    total_amount: 900,
    tax_amount: 0,
    discount_amount: 0,
    status: InvoiceStatus.ISSUED,
    issued_date: new Date('2026-02-01'),
    due_date: new Date('2026-02-10'),
    snapshot: {
      issuer,
      students: [
        {
          id: 'student-1',
          full_name: 'Rahim Uddin',
          registration_number: 'REG-0001',
          class_name: 'Class One',
          lines: [
            {
              fee_name: 'Monthly Tuition',
              period_label: 'Feb 2026',
              amount: 1000,
              discount: 100,
              paid_this_time: 900,
              balance_after: 0,
            },
          ],
        },
        {
          id: 'student-2',
          full_name: 'Karim Uddin',
          registration_number: 'REG-0002',
          class_name: 'Class Two',
          lines: [
            {
              fee_name: 'Monthly Tuition',
              period_label: 'Feb 2026',
              amount: 1000,
              discount: 0,
              paid_this_time: 1000,
              balance_after: 0,
            },
          ],
        },
      ],
      totals: {
        billed: 2000,
        discount: 100,
        paid: 1900,
        change: 0,
        wallet_used: 0,
        wallet_added: 0,
      },
      payment: {
        method: PaymentMethod.CASH,
        reference: null,
        received_by_name: 'Staff Member',
        payment_date: '2026-02-01',
      },
    },
    issued_by: null,
    issued_by_user_id: null,
    notes: null,
    issuer_snapshot: issuer,
    created_at: new Date('2026-02-01'),
    updated_at: new Date('2026-02-01'),
    deleted_at: null,
    ...overrides,
  } as Invoice;
}

function makePayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: 'payment-1',
    payment_date: new Date('2026-02-01'),
    payment_method: PaymentMethod.CASH,
    payment_status: PaymentStatus.SUCCESS,
    transaction_reference: null,
    total_amount: 900,
    ...overrides,
  } as Payment;
}

describe('renderInvoiceHtml (A4)', () => {
  it('renders both students, escaped, with Bengali-numeral amounts', () => {
    const html = renderInvoiceHtml(makeInvoice(), [makePayment()], issuer, null);

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('INV-2026-00001');
    expect(html).toContain('Rahim Uddin');
    expect(html).toContain('Karim Uddin');
    expect(html).toContain('১,০০০.০০'); // 1000 in Bengali digits
    expect(html).not.toContain('CREDIT NOTE');
  });

  it('shows the red CREDIT NOTE label and negative amounts for a credit note', () => {
    const html = renderInvoiceHtml(
      makeInvoice({ kind: InvoiceKind.CREDIT_NOTE }),
      [],
      issuer,
      null,
    );

    expect(html).toContain('Credit Note');
    expect(html).toContain('credit-note-badge');
    // snapshot amounts are stored positive (copied verbatim from the
    // original invoice) — the credit note must display them negated.
    expect(html).toContain('-১,০০০.০০');
  });

  it('filters snapshot.students down to the linked subset for a family caller', () => {
    const html = renderInvoiceHtml(makeInvoice(), [makePayment()], issuer, null, ['student-1']);

    expect(html).toContain('Rahim Uddin');
    expect(html).not.toContain('Karim Uddin');
    expect(html).not.toContain('REG-0002');
  });

  it('renders every student when linkedStudentIds is undefined (staff/admin)', () => {
    const html = renderInvoiceHtml(makeInvoice(), [makePayment()], issuer, null, undefined);

    expect(html).toContain('Rahim Uddin');
    expect(html).toContain('Karim Uddin');
  });

  it('hides the primary student header + payment history + unfiltered totals when the guardian is linked only to the NON-primary sibling', () => {
    // Rahim (student-1) is `invoice.student` — the payer/primary on this
    // multi-student checkout. A guardian linked only to Karim (student-2)
    // must never see Rahim's name/registration number (the "Student"
    // header block is driven off `invoice.student`, not the filtered
    // snapshot), the whole-payment "Payment History" table, or totals that
    // include Rahim's billed/discount/paid amounts.
    const html = renderInvoiceHtml(makeInvoice(), [makePayment()], issuer, null, ['student-2']);

    expect(html).toContain('Karim Uddin');
    expect(html).not.toContain('Rahim Uddin');
    expect(html).not.toContain('REG-0001');
    expect(html).not.toContain('Payment History');
    // Totals recomputed from Karim's line only (amount 1000, discount 0,
    // paid_this_time 1000), not the invoice-wide 2000/100/1900.
    expect(html).toContain('১,০০০.০০'); // billed = 1000
    expect(html).not.toContain('১,৯০০.০০'); // stale whole-payment "paid" (1900) must not leak
  });

  describe('amount in words', () => {
    const withPaid = (paid: number) => {
      const inv = makeInvoice();
      inv.snapshot.totals.paid = paid;
      return inv;
    };
    it('prints the paid total in English and Bangla words', () => {
      const html = renderInvoiceHtml(withPaid(2500), [makePayment()], issuer, null);
      expect(html).toContain('Taka Two Thousand Five Hundred only');
      expect(html).toContain('দুই হাজার পাঁচশত টাকা মাত্র');
      expect(html).toContain('২,৫০০.০০'); // same figure as the words
    });
    // Business-critical: the words must describe exactly the figure printed beside them.
    const expectWordsMatch = (paid: number, figure: string) => {
      const html = renderInvoiceHtml(withPaid(paid), [makePayment()], issuer, null);
      expect(html).toContain(`In words: ${amountInWords(paid, 'en')}`);
      expect(html).toContain(`কথায়: ${amountInWords(paid, 'bn')}`);
      expect(html).toContain(figure);
    };
    it('spells a lakh amount with paisa in fixed English and Bangla words', () => {
      // Hardcoded (not computed by the helper) so a wrong helper cannot pass.
      const html = renderInvoiceHtml(withPaid(1234567.5), [makePayment()], issuer, null);
      expect(html).toContain(
        'Taka Twelve Lakh Thirty-Four Thousand Five Hundred Sixty-Seven and Fifty Paisa only',
      );
      expect(html).toContain('বারো লক্ষ চৌত্রিশ হাজার পাঁচশত সাতষট্টি টাকা পঞ্চাশ পয়সা মাত্র');
    });
    it('boundary 0: words match the printed figure', () => {
      expectWordsMatch(0, '০.০০');
    });
    it('boundary 1: words match the printed figure', () => {
      expectWordsMatch(1, '১.০০');
    });
    it('boundary 99: words match the printed figure', () => {
      expectWordsMatch(99, '৯৯.০০');
    });
    it('boundary 100: words match the printed figure', () => {
      expectWordsMatch(100, '১০০.০০');
    });
    it('boundary 1000: words match the printed figure', () => {
      expectWordsMatch(1000, '১,০০০.০০');
    });
    it('boundary 100000: words match the printed figure', () => {
      expectWordsMatch(100000, '১০০,০০০.০০');
    });
    it('boundary 1234567.5: words match the printed figure', () => {
      expectWordsMatch(1234567.5, '১,২৩৪,৫৬৭.৫০');
    });
    it('boundary 0.01: words match the printed figure', () => {
      expectWordsMatch(0.01, '০.০১');
    });
    it('boundary 0.99: words match the printed figure', () => {
      expectWordsMatch(0.99, '০.৯৯');
    });

    it('a credit note prints the absolute amount in words', () => {
      const html = renderInvoiceHtml(
        { ...withPaid(2500), kind: InvoiceKind.CREDIT_NOTE } as Invoice,
        [],
        issuer,
        null,
      );
      expect(html).toContain('-২,৫০০.০০');
      expect(html).toContain('Taka Two Thousand Five Hundred only');
    });
    // #2399 M1: a bad snapshot total must not 500 the whole print; it just loses the words line.
    it('a non-finite paid total still renders, without the words line', () => {
      const html = renderInvoiceHtml(withPaid(NaN), [makePayment()], issuer, null);
      expect(html).toContain('Sunrise School');
      expect(html).not.toContain('In words:');
    });
    it("a guardian's partial view prints its own filtered total", () => {
      const html = renderInvoiceHtml(makeInvoice(), [makePayment()], issuer, null, ['student-2']);
      expect(html).toContain(amountInWords(1000, 'en'));
      expect(html).not.toContain(amountInWords(1900, 'en'));
    });
  });

  it('escapes a maliciously-named fee line rather than injecting it', () => {
    const invoice = makeInvoice();
    invoice.snapshot.students[0].lines[0].fee_name = '<script>alert(1)</script>';
    const html = renderInvoiceHtml(invoice, [], issuer, null);

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
