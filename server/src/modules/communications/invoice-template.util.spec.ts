import { describe, expect, it } from 'vitest';
import { buildInvoiceReceiptMessage } from './invoice-template.util';

describe('buildInvoiceReceiptMessage', () => {
  it('renders the bn message with Bengali digits and grouped thousands', () => {
    const message = buildInvoiceReceiptMessage(
      'bn',
      'INV-2026-000317',
      5000,
      'https://app.biddaloy.com/i/abc123',
    );
    expect(message).toBe(
      'রসিদ INV-2026-000317 · ৫,০০০ টাকা গৃহীত · দেখুন: https://app.biddaloy.com/i/abc123',
    );
  });

  it('renders the en message with Latin digits', () => {
    const message = buildInvoiceReceiptMessage(
      'en',
      'INV-2026-000317',
      5000,
      'https://app.biddaloy.com/i/abc123',
    );
    expect(message).toBe(
      'Receipt INV-2026-000317 · 5,000 BDT received · View: https://app.biddaloy.com/i/abc123',
    );
  });

  it('keeps two decimal places for a fractional amount, in both locales', () => {
    expect(buildInvoiceReceiptMessage('en', 'INV-1', 4200.5, 'http://x')).toContain('4,200.50 BDT');
    expect(buildInvoiceReceiptMessage('bn', 'INV-1', 4200.5, 'http://x')).toContain(
      '৪,২০০.৫০ টাকা',
    );
  });
});
