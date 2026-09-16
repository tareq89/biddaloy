import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { REGION_BD_EN } from '../../i18n/region-config';

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
});
