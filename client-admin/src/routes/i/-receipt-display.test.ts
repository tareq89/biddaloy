import type { InvoiceReceiptData } from '@biddaloy/ui/components';
import { REGION_BD_BN, REGION_BD_EN } from '@biddaloy/ui/i18n';
import { describe, expect, it } from 'vitest';

import { localizePeriod, toDisplayReceipt } from './-receipt-display';

describe('localizePeriod', () => {
  it('renders the English snapshot in the visitor region', () => {
    expect(localizePeriod('January 2026', REGION_BD_BN)).toBe('জানুয়ারি ২০২৬');
    expect(localizePeriod('January 2026', REGION_BD_EN)).toBe('January 2026');
  });

  it('leaves anything that is not "<Month> <year>" as it is', () => {
    expect(localizePeriod('', REGION_BD_BN)).toBe('');
    expect(localizePeriod('Term 1', REGION_BD_BN)).toBe('Term 1');
  });
});

describe('toDisplayReceipt', () => {
  it('maps the payment method and periods, and leaves totals untouched', () => {
    const receipt = {
      students: [{ full_name: 'A', class_name: null, lines: [{ period_label: 'March 2026' }] }],
      totals: { billed: 100, discount: 0, paid: 100, change: 0 },
      payment: { method: 'CASH', reference_last4: null, payment_date: '2026-03-01' },
    } as unknown as InvoiceReceiptData;

    const out = toDisplayReceipt(receipt, REGION_BD_EN, (m) => `label:${m}`);

    expect(out.payment.method).toBe('label:CASH');
    expect(out.students[0]!.lines[0]!.period_label).toBe('March 2026');
    expect(out.totals).toEqual(receipt.totals);
  });
});
