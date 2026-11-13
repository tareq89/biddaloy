import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import {
  renderBundleReceiptHtml,
  renderReceiptHtml,
  type BundleReceiptData,
  type ReceiptData,
} from './receipt.template';

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

// Seat output golden: hashes taken from the template before the bundle receipt shared its page.
describe('renderReceiptHtml golden', () => {
  const h = (d: ReceiptData) =>
    createHash('sha256').update(renderReceiptHtml(d)).digest('hex').slice(0, 16);
  const seat: ReceiptData = {
    ...base,
    orderId: 'o1',
    schoolName: 'G <V>',
    reference: 'T1',
  };
  it('seat receipts render byte for byte as before', () => {
    expect(h(seat)).toBe('db28addda06f7801');
    expect(h({ ...seat, vatRegistration: 'BIN-1' })).toBe('a8903a03f246a23b');
    expect(h({ ...seat, locale: 'bn' })).toBe('bedbf1d52212438d');
    expect(h({ ...seat, locale: 'bn', vatRegistration: 'BIN-1' })).toBe('2993c66982fd3dc2');
  });
});

const bundle: BundleReceiptData = {
  receiptNumber: 'SMR-2027-000007',
  orderId: '3f2b8c1e-5d4a-4b6e-9c7d-1a2b3c4d5e6f',
  schoolName: 'Green <Valley> School',
  schoolAddress: 'Dhaka',
  packageName: 'Starter',
  smsCount: 500,
  validityDays: 30,
  amountPaisa: 10_000,
  expiresOn: '2027-01-31',
  method: 'BKASH',
  reference: 'TRX9',
  paidAt: new Date('2027-01-01T06:00:00Z'),
  locale: 'en',
  vatLine: null,
  couponLine: null,
};

describe('renderBundleReceiptHtml', () => {
  it('en: package row, validity date, total, same SMR number', () => {
    const html = renderBundleReceiptHtml(bundle);
    expect(html).toContain('SMR-2027-000007');
    expect(html).toContain('Starter, 500 SMS, valid 30 days');
    expect(html).toContain('2027-01-31');
    expect(html).toContain('৳100.00');
    expect(html).toContain('bKash');
  });

  it('bn: Bangla copy and numerals', () => {
    const html = renderBundleReceiptHtml({ ...bundle, locale: 'bn' });
    expect(html).toContain('এসএমএস প্যাকেজ');
    expect(html).toContain('৫০০টি এসএমএস, মেয়াদ ৩০ দিন');
    expect(html).toContain('২০২৭-০১-৩১');
    expect(html).toContain('৳১০০.০০');
  });

  it('prints VAT and coupon lines only when given', () => {
    const none = renderBundleReceiptHtml(bundle);
    expect(none).not.toContain('VAT');
    expect(none).not.toContain('Coupon');
    const both = renderBundleReceiptHtml({ ...bundle, vatLine: '15% incl.', couponLine: '-৳10' });
    expect(both).toContain('15% incl.');
    expect(both).toContain('Coupon');
  });

  it('escapes the school name', () => {
    const html = renderBundleReceiptHtml(bundle);
    expect(html).toContain('Green &lt;Valley&gt; School');
    expect(html).not.toContain('<Valley>');
  });
});
