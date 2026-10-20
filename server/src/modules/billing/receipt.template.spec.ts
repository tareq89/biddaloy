import { describe, it, expect } from 'vitest';
import { renderReceiptHtml, type ReceiptData } from './receipt.template';

const base: ReceiptData = {
  receiptNumber: 'SMR-2026-000012',
  orderId: '3f2b8c1e-5d4a-4b6e-9c7d-1a2b3c4d5e6f',
  schoolName: 'Green <Valley> School',
  schoolAddress: 'Dhaka',
  seats: 300,
  months: 10,
  unitPricePaisa: 1000,
  amountPaisa: 3_000_000,
  periodStart: '2027-01-01',
  periodEnd: '2027-11-01',
  method: 'BKASH',
  reference: 'TRX123',
  paidAt: new Date('2027-01-01T06:00:00Z'),
  locale: 'en',
  vatRegistration: null,
};

describe('renderReceiptHtml', () => {
  it('shows the receipt number, seats x months x price and the total', () => {
    const html = renderReceiptHtml(base);
    expect(html).toContain('SMR-2026-000012');
    expect(html).toContain('300 seats x 10 months x ৳10.00');
    expect(html).toContain('৳30,000.00');
    expect(html).toContain('bKash');
  });

  it('prints the VAT line and number only when the registration is configured', () => {
    expect(renderReceiptHtml(base)).not.toContain('VAT');
    const withVat = renderReceiptHtml({ ...base, vatRegistration: 'BIN-001234567' });
    expect(withVat).toContain('VAT registration');
    expect(withVat).toContain('BIN-001234567');
  });

  it('renders Bangla copy with Bangla numerals when the school locale is bn', () => {
    const html = renderReceiptHtml({ ...base, locale: 'bn' });
    expect(html).toContain('পেমেন্ট রসিদ');
    expect(html).toContain('৳৩০,০০০.০০');
    expect(html).toContain('বিকাশ');
  });

  it('escapes school-controlled text (no markup injection)', () => {
    const html = renderReceiptHtml(base);
    expect(html).toContain('Green &lt;Valley&gt; School');
    expect(html).not.toContain('<Valley>');
  });
});
