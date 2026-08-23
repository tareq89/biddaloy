import { REGION_BD_EN } from '@biddaloy/ui/i18n';
import { paymentFactory, studentFeeFactory } from '@biddaloy/ui/test';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildReceiptHtml, printReceipt } from './receipt';

const LABELS = { period: 'Period', amount: 'Allocated' };

describe('buildReceiptHtml', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses the caller-supplied translated column headers, not hardcoded English', () => {
    const payment = paymentFactory({
      allocations: [
        {
          id: 'alloc-1',
          payment: {} as never,
          payment_id: 'payment-1',
          student_fee: studentFeeFactory({ month: 3, year: 2026 }),
          student_fee_id: 'fee-1',
          allocated_amount: 500,
          allocation_type: 'DUE',
          notes: null,
          created_at: new Date().toISOString(),
        },
      ],
    });
    const bnLabels = { period: 'মাস/বছর', amount: 'বরাদ্দকৃত' };

    const html = buildReceiptHtml(payment, 'Karim Rahman', REGION_BD_EN, bnLabels);

    expect(html).toContain('<th>মাস/বছর</th>');
    expect(html).toContain('<th>বরাদ্দকৃত</th>');
    expect(html).not.toContain('<th>Period</th>');
    expect(html).not.toContain('<th>Amount</th>');
  });

  it('formats the payment date using the region config’s locale, not the browser default', () => {
    const payment = paymentFactory({
      payment_date: '2026-03-15T00:00:00.000Z',
      allocations: [],
    });
    const toLocaleDateStringSpy = vi.spyOn(Date.prototype, 'toLocaleDateString');

    buildReceiptHtml(payment, 'Karim Rahman', REGION_BD_EN, LABELS);

    expect(toLocaleDateStringSpy).toHaveBeenCalledWith(REGION_BD_EN.locale);
  });
});

describe('printReceipt', () => {
  // jsdom doesn't implement `URL.createObjectURL`/`revokeObjectURL` at
  // all — same stub-and-restore pattern `fees/dues.test.tsx` and
  // `students/index.test.tsx` use for the same gap.
  function stubObjectUrl() {
    let revokedUrl: string | undefined;
    URL.createObjectURL = () => 'blob:mock-url';
    URL.revokeObjectURL = (url: string) => {
      revokedUrl = url;
    };
    return {
      revokedUrl: () => revokedUrl,
      restore: () => {
        delete (URL as { createObjectURL?: unknown }).createObjectURL;
        delete (URL as { revokeObjectURL?: unknown }).revokeObjectURL;
      },
    };
  }

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('revokes the object URL immediately and returns false when the popup is blocked', () => {
    const stub = stubObjectUrl();
    vi.spyOn(window, 'open').mockReturnValue(null);

    try {
      const payment = paymentFactory({ allocations: [] });
      const result = printReceipt(payment, 'Karim Rahman', REGION_BD_EN, LABELS);

      expect(result).toBe(false);
      expect(stub.revokedUrl()).toBe('blob:mock-url');
    } finally {
      stub.restore();
    }
  });

  it('returns true and revokes the object URL later when the popup opens', () => {
    vi.useFakeTimers();
    const stub = stubObjectUrl();
    vi.spyOn(window, 'open').mockReturnValue({} as Window);

    try {
      const payment = paymentFactory({ allocations: [] });
      const result = printReceipt(payment, 'Karim Rahman', REGION_BD_EN, LABELS);

      expect(result).toBe(true);
      expect(stub.revokedUrl()).toBeUndefined();
      vi.advanceTimersByTime(60_000);
      expect(stub.revokedUrl()).toBe('blob:mock-url');
    } finally {
      stub.restore();
    }
  });
});
