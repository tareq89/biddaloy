import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { REGION_BD_EN } from '../../i18n/region-config';

import { InvoiceReceipt, type InvoiceReceiptData } from './invoice-receipt';

const RECEIPT: InvoiceReceiptData = {
  invoice_number: 'INV-2026-000123',
  issued_date: '2026-09-01',
  due_date: '2026-09-15',
  total_amount: 5000,
  tax_amount: 0,
  discount_amount: 500,
  notes: 'Thank you.',
  student: { full_name: 'Rahim Ahmed' },
  issuer: {
    name: 'Ananta High School',
    name_bn: null,
    address: null,
    phone: null,
    email: null,
    registration_id: null,
    logo_key: null,
  },
};

const LABELS = {
  creditNote: 'Credit note',
  issuedDate: 'Issue date',
  dueDate: 'Due date',
  tax: 'Tax',
  discount: 'Discount',
  total: 'Total',
};

describe('InvoiceReceipt', () => {
  it('renders the invoice number, student name and issuer', () => {
    render(<InvoiceReceipt receipt={RECEIPT} width="a4" config={REGION_BD_EN} labels={LABELS} />);
    expect(screen.getByText('INV-2026-000123')).toBeTruthy();
    expect(screen.getByText('Rahim Ahmed')).toBeTruthy();
    expect(screen.getByText('Ananta High School')).toBeTruthy();
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

  it('renders notes when present, and omits them when absent', () => {
    const { rerender } = render(
      <InvoiceReceipt receipt={RECEIPT} width="a4" config={REGION_BD_EN} labels={LABELS} />,
    );
    expect(screen.getByText('Thank you.')).toBeTruthy();

    rerender(
      <InvoiceReceipt
        receipt={{ ...RECEIPT, notes: null }}
        width="a4"
        config={REGION_BD_EN}
        labels={LABELS}
      />,
    );
    expect(screen.queryByText('Thank you.')).toBeNull();
  });
});
