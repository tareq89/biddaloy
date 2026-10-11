import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { REGION_BD_BN, REGION_BD_EN } from '../../i18n/region-config';

import { InvoiceReceipt, type InvoiceReceiptData } from './invoice-receipt';

const RECEIPT: InvoiceReceiptData = {
  invoice_number: 'INV-2026-000123',
  issued_date: '2026-09-01',
  school: {
    name: 'Ananta High School',
    address: null,
    logo_url: null,
  },
  students: [
    {
      full_name: 'Rahim Ahmed',
      class_name: null,
      lines: [
        {
          fee_name: 'Monthly Tuition',
          period_label: 'September 2026',
          amount: 5000,
          discount: 500,
          paid_this_time: 4500,
          balance_after: 0,
        },
      ],
    },
  ],
  totals: { billed: 5000, discount: 500, paid: 4500, change: 0 },
  payment: { method: 'CASH', reference_last4: null, payment_date: '2026-09-01' },
};

const LABELS = {
  creditNote: 'Credit note',
  issuedDate: 'Issue date',
  billed: 'Billed',
  discount: 'Discount',
  paid: 'Paid',
  change: 'Change',
  paymentMethod: 'Payment method',
  paymentDate: 'Payment date',
  inWords: 'In words',
};

describe('InvoiceReceipt', () => {
  it('renders the invoice number, student name and school', () => {
    render(<InvoiceReceipt receipt={RECEIPT} width="a4" config={REGION_BD_EN} labels={LABELS} />);
    expect(screen.getByText('INV-2026-000123')).toBeTruthy();
    expect(screen.getByText('Rahim Ahmed')).toBeTruthy();
    expect(screen.getByText('Ananta High School')).toBeTruthy();
  });

  it('renders one line group per student for a multi-student invoice', () => {
    render(
      <InvoiceReceipt
        receipt={{
          ...RECEIPT,
          students: [
            ...RECEIPT.students,
            { full_name: 'Karim Ahmed', class_name: null, lines: [] },
          ],
        }}
        width="a4"
        config={REGION_BD_EN}
        labels={LABELS}
      />,
    );
    expect(screen.getByText('Rahim Ahmed')).toBeTruthy();
    expect(screen.getByText('Karim Ahmed')).toBeTruthy();
  });

  it('does not show a credit-note badge for a regular invoice', () => {
    render(<InvoiceReceipt receipt={RECEIPT} width="a4" config={REGION_BD_EN} labels={LABELS} />);
    expect(screen.queryByText('Credit note')).toBeNull();
  });

  it('shows a credit-note badge when kind is CREDIT_NOTE', () => {
    render(
      <InvoiceReceipt
        receipt={{ ...RECEIPT, kind: 'CREDIT_NOTE' }}
        width="a4"
        config={REGION_BD_EN}
        labels={LABELS}
      />,
    );
    expect(screen.getByText('Credit note')).toBeTruthy();
  });

  it('shows the payment method and redacted reference', () => {
    render(
      <InvoiceReceipt
        receipt={{ ...RECEIPT, payment: { ...RECEIPT.payment, reference_last4: '9F2A' } }}
        width="a4"
        config={REGION_BD_EN}
        labels={LABELS}
      />,
    );
    expect(screen.getByText(/CASH/)).toBeTruthy();
    expect(screen.getByText(/9F2A/)).toBeTruthy();
  });

  it('shows change only when there is one', () => {
    const { rerender } = render(
      <InvoiceReceipt receipt={RECEIPT} width="a4" config={REGION_BD_EN} labels={LABELS} />,
    );
    expect(screen.queryByText('Change')).toBeNull();

    rerender(
      <InvoiceReceipt
        receipt={{ ...RECEIPT, totals: { ...RECEIPT.totals, change: 100 } }}
        width="a4"
        config={REGION_BD_EN}
        labels={LABELS}
      />,
    );
    expect(screen.getByText('Change')).toBeTruthy();
  });

  it('shows the paid total in words in the region language', () => {
    const { rerender } = render(
      <InvoiceReceipt receipt={RECEIPT} width="a4" config={REGION_BD_EN} labels={LABELS} />,
    );
    // 4500 paid: English config -> English words, never Bangla.
    expect(screen.getByText('In words: Taka Four Thousand Five Hundred only')).toBeTruthy();

    rerender(<InvoiceReceipt receipt={RECEIPT} width="a4" config={REGION_BD_BN} labels={LABELS} />);
    expect(screen.getByText(/^In words: চার হাজার পাঁচশত টাকা মাত্র$/)).toBeTruthy();
  });

  // Business-critical: the words must describe exactly the paid figure (absolute value).
  const expectWords = (paid: number, words: string) => {
    render(
      <InvoiceReceipt
        receipt={{ ...RECEIPT, totals: { ...RECEIPT.totals, paid } }}
        width="a4"
        config={REGION_BD_EN}
        labels={LABELS}
      />,
    );
    expect(screen.getByText(`In words: ${words}`)).toBeTruthy();
  };
  it('boundary 0', () => {
    expectWords(0, 'Taka Zero only');
  });
  it('boundary 1', () => {
    expectWords(1, 'Taka One only');
  });
  it('boundary 99', () => {
    expectWords(99, 'Taka Ninety-Nine only');
  });
  it('boundary 100', () => {
    expectWords(100, 'Taka One Hundred only');
  });
  it('boundary 1000', () => {
    expectWords(1000, 'Taka One Thousand only');
  });
  it('boundary 100000', () => {
    expectWords(100000, 'Taka One Lakh only');
  });
  it('boundary 0.01', () => {
    expectWords(0.01, 'Taka Zero and One Paisa only');
  });
  it('boundary 0.99', () => {
    expectWords(0.99, 'Taka Zero and Ninety-Nine Paisa only');
  });
  it('boundary 1234567.5', () => {
    expectWords(
      1234567.5,
      'Taka Twelve Lakh Thirty-Four Thousand Five Hundred Sixty-Seven and Fifty Paisa only',
    );
  });
  it('credit note (negative paid) reads as its absolute value', () => {
    expectWords(-2500, 'Taka Two Thousand Five Hundred only');
  });
});
