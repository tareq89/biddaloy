import { REGION_BD_BN, REGION_BD_EN } from '@biddaloy/ui/i18n';
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

  it('[15.5.7] renders the issuer header (name, address, EIIN, logo) when the payment has one', () => {
    const payment = paymentFactory({
      allocations: [],
      tenant_id: 'school-1',
      issuer: {
        name: 'Ananta High School',
        name_bn: 'অনন্ত উচ্চ বিদ্যালয়',
        address: '123 Green Road',
        phone: '+8801700000000',
        email: 'info@example.com',
        registration_id: 'EIIN-999',
        logo_key: 'tenants/school-1/logo/abc-123.png',
      },
    } as never);

    const html = buildReceiptHtml(
      payment,
      'Karim Rahman',
      REGION_BD_EN,
      LABELS,
      '/api/v1/schools/school-1/logo?v=abc-123',
    );

    expect(html).toContain('Ananta High School');
    expect(html).toContain('123 Green Road');
    expect(html).toContain('EIIN: EIIN-999');
    expect(html).toContain('/api/v1/schools/school-1/logo?v=abc-123');
    // English-first for a non-bn region config.
    expect(html.indexOf('Ananta High School')).toBeLessThan(html.indexOf('অনন্ত উচ্চ বিদ্যালয়'));
  });

  it('[15.5.7] shows the Bengali name first when the region locale is Bengali', () => {
    const payment = paymentFactory({
      allocations: [],
      issuer: {
        name: 'Ananta High School',
        name_bn: 'অনন্ত উচ্চ বিদ্যালয়',
        address: null,
        phone: null,
        email: null,
        registration_id: null,
        logo_key: null,
      },
    } as never);

    const html = buildReceiptHtml(payment, 'Karim Rahman', REGION_BD_BN, LABELS);

    expect(html.indexOf('অনন্ত উচ্চ বিদ্যালয়')).toBeLessThan(html.indexOf('Ananta High School'));
  });

  it('[15.5.7] renders no issuer header at all when the payment has no issuer (legacy row)', () => {
    const payment = paymentFactory({ allocations: [] });

    const html = buildReceiptHtml(payment, 'Karim Rahman', REGION_BD_EN, LABELS);

    expect(html).not.toContain('class="issuer"');
  });

  it('[15.5.7] omits the logo <img> when logo_key is null', () => {
    const payment = paymentFactory({
      allocations: [],
      issuer: {
        name: 'Ananta High School',
        name_bn: null,
        address: null,
        phone: null,
        email: null,
        registration_id: null,
        logo_key: null,
      },
    } as never);

    // Even given a resolved `logoDataUrl` — a null `logo_key` means there
    // was never anything to fetch, so the header must not render an
    // `<img>` regardless of what's passed here.
    const html = buildReceiptHtml(
      payment,
      'Karim Rahman',
      REGION_BD_EN,
      LABELS,
      'data:image/png;base64,AAAA',
    );

    expect(html).not.toContain('<img class="issuer-logo"');
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

  it('returns false when the popup is blocked, without building or revoking anything', async () => {
    // `printReceipt` now opens the window (empty) *before* fetching a logo
    // or building the HTML — mirrors `openPrintableInvoice`'s
    // open-before-`await` reasoning. A blocked popup is caught at that
    // first call, so no object URL is ever created here.
    const stub = stubObjectUrl();
    vi.spyOn(window, 'open').mockReturnValue(null);

    try {
      const payment = paymentFactory({ allocations: [] });
      const result = await printReceipt(payment, 'Karim Rahman', REGION_BD_EN, LABELS);

      expect(result).toBe(false);
      expect(stub.revokedUrl()).toBeUndefined();
    } finally {
      stub.restore();
    }
  });

  it('returns true and revokes the object URL later when the popup opens', async () => {
    vi.useFakeTimers();
    const stub = stubObjectUrl();
    // `printReceipt` opens the window with an empty document first, then
    // sets `.location.href` once the HTML is built — a plain `{}` mock
    // (no `location`) would throw on that assignment.
    const fakeWindow = { location: { href: '' } } as unknown as Window;
    vi.spyOn(window, 'open').mockReturnValue(fakeWindow);

    try {
      const payment = paymentFactory({ allocations: [] });
      const result = await printReceipt(payment, 'Karim Rahman', REGION_BD_EN, LABELS);

      expect(result).toBe(true);
      expect(stub.revokedUrl()).toBeUndefined();
      vi.advanceTimersByTime(60_000);
      expect(stub.revokedUrl()).toBe('blob:mock-url');
    } finally {
      stub.restore();
    }
  });
});
