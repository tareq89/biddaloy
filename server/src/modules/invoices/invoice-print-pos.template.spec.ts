import { describe, it, expect } from 'vitest';
import { amountInWords, InvoiceKind, InvoiceStatus, PaymentMethod } from '@biddaloy/shared';
import { renderInvoicePosHtml } from './invoice-print-pos.template';
import { Invoice } from './entities/invoice.entity';
import { IssuerSnapshot } from '../schools/profile/issuer-snapshot';

const issuer: IssuerSnapshot = {
  name: 'Sunrise School',
  name_bn: null,
  address: '12 Main Road',
  phone: '01700000000',
  email: null,
  registration_id: null,
  logo_key: null,
  captured_at: '2026-01-01T00:00:00.000Z',
};

function makeInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: 'inv-1',
    invoice_number: 'INV-2026-00001',
    kind: InvoiceKind.INVOICE,
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
              amount: 900,
              discount: 0,
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
      totals: { billed: 1900, discount: 0, paid: 1900, change: 0, wallet_used: 0, wallet_added: 0 },
      payment: {
        method: PaymentMethod.BKASH,
        reference: 'TRX9F2',
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

describe('renderInvoicePosHtml', () => {
  it('58mm: sets the @page rule and 32-column width, renders both students and the payment method line', () => {
    const html = renderInvoicePosHtml(makeInvoice(), issuer, null, 'pos58');

    expect(html).toContain('@page { size: 58mm auto; margin: 2mm }');
    expect(html).toContain('width: 58mm');
    expect(html).toContain('Rahim Uddin');
    expect(html).toContain('Karim Uddin');
    expect(html).toContain('Paid via BKASH');
    expect(html).toContain('TRX9F2');
    expect(html).toContain('Thank you');
    expect(html).toContain('page-break-inside: avoid');
  });

  it('80mm: sets the @page rule and 48-column width', () => {
    const html = renderInvoicePosHtml(makeInvoice(), issuer, null, 'pos80');

    expect(html).toContain('@page { size: 80mm auto; margin: 2mm }');
    expect(html).toContain('width: 80mm');
  });

  it('renders no QR block when no public share link exists', () => {
    const html = renderInvoicePosHtml(makeInvoice(), issuer, null, 'pos58');
    expect(html).not.toContain('Scan for a copy');
    expect(html).not.toContain('class="section qr-section"');
  });

  it('renders a QR/link block when a public share link is passed', () => {
    const html = renderInvoicePosHtml(
      makeInvoice(),
      issuer,
      null,
      'pos58',
      undefined,
      'https://biddaloy.example/i/abc123',
    );
    expect(html).toContain('Scan for a copy');
    expect(html).toContain('https://biddaloy.example/i/abc123');
  });

  it('shows CREDIT NOTE label for a credit note, with negated line amounts', () => {
    const html = renderInvoicePosHtml(
      makeInvoice({ kind: InvoiceKind.CREDIT_NOTE }),
      issuer,
      null,
      'pos58',
    );
    expect(html).toContain('CREDIT NOTE');
    expect(html).toContain('-৯০০.০০');
  });

  it('filters snapshot.students down to the linked subset for a family caller', () => {
    const html = renderInvoicePosHtml(makeInvoice(), issuer, null, 'pos58', ['student-1']);
    expect(html).toContain('Rahim Uddin');
    expect(html).not.toContain('Karim Uddin');
    expect(html).not.toContain('REG-0002');
  });

  describe('amount in words', () => {
    const withPaid = (paid: number) => {
      const inv = makeInvoice();
      inv.snapshot.totals.paid = paid;
      return inv;
    };
    // Both thermal widths share one template; check each explicitly.
    const expectTwoThousandFiveHundred = (w: 'pos58' | 'pos80') => {
      const html = renderInvoicePosHtml(withPaid(2500), issuer, null, w);
      expect(html).toContain('Taka Two Thousand Five Hundred only');
      expect(html).toContain('দুই হাজার পাঁচশত টাকা মাত্র');
      expect(html).toContain('২,৫০০.০০');
    };
    it('pos58: prints the paid total in English and Bangla words', () => {
      expectTwoThousandFiveHundred('pos58');
    });
    it('pos80: prints the paid total in English and Bangla words', () => {
      expectTwoThousandFiveHundred('pos80');
    });
    // Business-critical: the words must describe exactly the figure printed beside them.
    const expectWordsMatch = (paid: number, figure: string) => {
      const html = renderInvoicePosHtml(withPaid(paid), issuer, null, 'pos58');
      expect(html).toContain(amountInWords(paid, 'en'));
      expect(html).toContain(amountInWords(paid, 'bn'));
      expect(html).toContain(figure);
    };
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
      const html = renderInvoicePosHtml(
        { ...withPaid(2500), kind: InvoiceKind.CREDIT_NOTE } as Invoice,
        issuer,
        null,
        'pos58',
      );
      expect(html).toContain('-২,৫০০.০০');
      expect(html).toContain('Taka Two Thousand Five Hundred only');
    });
    // #2399 M1: a bad snapshot total must not 500 the whole print; it just loses the words lines.
    it('a non-finite paid total still renders, without the words lines', () => {
      const html = renderInvoicePosHtml(withPaid(Infinity), issuer, null, 'pos58');
      expect(html).toContain('Sunrise School');
      expect(html).not.toContain('In words:');
      expect(html).not.toContain('কথায়:');
    });
    it("a guardian's partial view prints its own filtered total", () => {
      const html = renderInvoicePosHtml(makeInvoice(), issuer, null, 'pos58', ['student-2']);
      expect(html).toContain(amountInWords(1000, 'en'));
      expect(html).not.toContain(amountInWords(1900, 'en'));
    });
  });
});
