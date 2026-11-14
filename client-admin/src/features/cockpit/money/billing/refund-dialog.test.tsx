import '@biddaloy/ui/test';

import { SeatOrderStatus } from '@biddaloy/shared';
import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import bn from '../../../../../../ui/src/i18n/locales/bn/moneyBilling.json';
import en from '../../../../../../ui/src/i18n/locales/en/moneyBilling.json';

import { RefundDialog, type RefundTarget } from './refund-dialog';

const opts = { locale: 'en', role: 'SUPER_ADMIN', tenantId: 'platform' } as const;
const SCHOOL = 'school-1';

const seat = (over: Partial<RefundTarget> = {}): RefundTarget =>
  ({
    kind: 'seat',
    id: 'order-1',
    school_id: SCHOOL,
    seats: 50,
    months: 3,
    unit_price_paisa: 1000,
    amount_paisa: 150_000,
    period_start: '2026-11-02',
    period_end: '2027-02-02',
    status: SeatOrderStatus.PAID,
    method: null,
    receipt_number: 'SMR-2026-000001',
    paid_at: '2026-11-02T04:00:00.000Z',
    created_at: '2026-11-02T04:00:00.000Z',
    coupon_code: null,
    ...over,
  }) as RefundTarget;

const pkg = (over: Partial<RefundTarget> = {}): RefundTarget =>
  ({
    kind: 'package',
    id: 'pkg-1',
    status: 'ACTIVE',
    bundle_name: 'Starter',
    sms_count: 5000,
    amount_paisa: 150_000,
    receipt_number: 'SMR-2026-000002',
    paid_at: '2026-11-12T04:00:00.000Z',
    refunded_at: null,
    units_bought: 5000,
    units_used: 0,
    refundable: true,
    ...over,
  }) as RefundTarget;

const approvalRequired = () =>
  HttpResponse.json(
    {
      statusCode: 403,
      message: 'x',
      timestamp: '',
      path: '/',
      requestId: 'r',
      details: { code: 'APPROVAL_REQUIRED' },
    },
    { status: 403 },
  );
const conflict = (code: string) =>
  HttpResponse.json(
    {
      statusCode: 409,
      message: 'server words',
      details: { code },
      requestId: 'r',
      path: '/x',
      timestamp: '2026-01-01T00:00:00.000Z',
    },
    { status: 409 },
  );

const SEAT_URL = '*/platform/billing/orders/:id/refund';
const PKG_URL = '*/platform/billing/sms-bundle-orders/:id/refund';

const mount = (order: RefundTarget | null, onOpenChange = vi.fn()) =>
  renderWithProviders(
    <RefundDialog
      open
      onOpenChange={onOpenChange}
      schoolId={SCHOOL}
      schoolName="Green Valley School"
      order={order}
    />,
    opts,
  );

afterEach(async () => {
  await cleanupTestState();
});

describe('RefundDialog', () => {
  it('shows the amount in taka, the order and a required reason', async () => {
    const { container } = mount(seat());
    expect(await screen.findByText('Refund ৳১,৫০০.০০?')).toBeTruthy();
    await expect(container).toHaveNoViolations();
    expect(screen.getByText('Green Valley School: ৫০ seats for ৩ months.')).toBeTruthy();
    expect(screen.getByLabelText('Reason')).toBeTruthy();
  });

  it.each(['', 'abc', 'x'.repeat(301)])('needs a 5-300 character reason (%#)', async (reason) => {
    let hit = false;
    server.use(http.post(SEAT_URL, () => ((hit = true), HttpResponse.json({}))));
    const user = userEvent.setup();
    mount(seat());
    if (reason) await user.type(await screen.findByLabelText('Reason'), reason);
    await user.click(await screen.findByRole('button', { name: 'Refund' }));
    expect(await screen.findByText('Write a reason of 5 to 300 characters.')).toBeTruthy();
    expect(hit).toBe(false);
  });

  it('asks for the code, sends reason and one Idempotency-Key, then shows the bKash step', async () => {
    const seen: { token: string | null; key: string | null; body: unknown }[] = [];
    server.use(
      http.post(SEAT_URL, async ({ request }) => {
        const token = request.headers.get('X-Approval-Token');
        seen.push({
          token,
          key: request.headers.get('Idempotency-Key'),
          body: await request.json(),
        });
        return token
          ? HttpResponse.json({
              applied: true,
              order_id: 'order-1',
              gateway_ref: 'ABC123',
              note: 'n',
            })
          : approvalRequired();
      }),
    );
    const user = userEvent.setup();
    mount(seat({ coupon_code: 'WELCOME' }));
    await user.type(await screen.findByLabelText('Reason'), 'Paid twice by mistake');
    await user.click(screen.getByRole('button', { name: 'Refund' }));
    await user.type(await screen.findByLabelText('Authenticator code'), '123456');
    await user.keyboard('{Enter}');

    const result = await screen.findByTestId('refund-result');
    expect(result.textContent).toContain(
      'Return the money from the bKash panel; this app only records the refund.',
    );
    expect(result.textContent).toContain('Use this reference: ABC123');
    expect(result.textContent).toContain('A coupon used on this order is not given back.');
    expect(screen.queryByRole('button', { name: 'Refund' })).toBeNull();
    const calls = seen.filter((c) => c.token);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toEqual({ reason: 'Paid twice by mistake' });
    expect(calls[0]!.key).toBeTruthy();
    // the step-up retry re-sends the same key as the first attempt
    expect(seen[0]!.key).toBe(calls[0]!.key);
  });

  it('leaves the coupon line out when no coupon was used, and says an already-refunded order is', async () => {
    server.use(
      http.post(SEAT_URL, () =>
        HttpResponse.json({ applied: false, order_id: 'order-1', gateway_ref: null, note: 'n' }),
      ),
    );
    const user = userEvent.setup();
    mount(seat());
    await user.type(await screen.findByLabelText('Reason'), 'Paid twice by mistake');
    await user.click(screen.getByRole('button', { name: 'Refund' }));
    const result = await screen.findByTestId('refund-result');
    expect(result.textContent).toContain('This order was already refunded.');
    expect(result.textContent).not.toContain('coupon');
    expect(result.textContent).not.toContain('Use this reference');
  });

  it('sends a package refund to the package route', async () => {
    let url = '';
    server.use(
      http.post(PKG_URL, ({ request }) => {
        url = request.url;
        return HttpResponse.json({
          applied: true,
          order_id: 'pkg-1',
          gateway_ref: null,
          note: 'n',
        });
      }),
    );
    const user = userEvent.setup();
    mount(pkg());
    expect(await screen.findByText('Green Valley School: Starter, ৫,০০০ SMS.')).toBeTruthy();
    await user.type(screen.getByLabelText('Reason'), 'School closed');
    await user.click(screen.getByRole('button', { name: 'Refund' }));
    await screen.findByTestId('refund-result');
    expect(url).toContain('/platform/billing/sms-bundle-orders/pkg-1/refund');
  });

  it('shows the used sentence and no Refund button for a package already used', async () => {
    mount(pkg({ refundable: false, units_used: 10 }));
    expect(
      await screen.findByText('Some of this package is already used, so it cannot be refunded.'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Refund' })).toBeNull();
  });

  it('shows the free sentence and no Refund button for a free (zero-price) seat order', async () => {
    mount(seat({ amount_paisa: 0 }));
    expect(
      await screen.findByText('This order was free, so there is nothing to refund.'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Refund' })).toBeNull();
  });

  it.each([
    ['ORDER_NOT_REFUNDABLE', 'This order cannot be refunded.'],
    ['BUNDLE_ALREADY_USED', 'Some of this package is already used, so it cannot be refunded.'],
    ['SOMETHING_ELSE', 'Could not refund. Try again.'],
  ])('maps %s to a fixed sentence, never the server text', async (code, sentence) => {
    server.use(http.post(SEAT_URL, () => conflict(code)));
    const user = userEvent.setup();
    mount(seat());
    await user.type(await screen.findByLabelText('Reason'), 'Paid twice by mistake');
    await user.click(screen.getByRole('button', { name: 'Refund' }));
    expect((await screen.findByRole('alert')).textContent).toBe(sentence);
    expect(screen.queryByText(/server words/)).toBeNull();
  });

  it('shows the generic sentence for a non-409 failure', async () => {
    server.use(
      http.post(SEAT_URL, () =>
        HttpResponse.json({ statusCode: 500, message: 'secret detail' }, { status: 500 }),
      ),
    );
    const user = userEvent.setup();
    mount(seat());
    await user.type(await screen.findByLabelText('Reason'), 'Paid twice by mistake');
    await user.click(screen.getByRole('button', { name: 'Refund' }));
    expect(await screen.findByText('Could not refund. Try again.')).toBeTruthy();
    expect(screen.queryByText(/secret detail/)).toBeNull();
  });
});

const strings = (v: unknown): string[] =>
  typeof v === 'string' ? [v] : Object.values(v as object).flatMap(strings);
const keys = (v: unknown, p = ''): string[] =>
  typeof v === 'string'
    ? [p]
    : Object.entries(v as object).flatMap(([k, x]) => keys(x, `${p}.${k}`));

// Glossary "Never say" column (D15).
const never = [
  'bundle',
  'stock',
  'lot',
  'ledger',
  'allocation',
  'voucher',
  'promo code',
  'reversal',
  'chargeback',
  'tax rate',
  'levy',
  'tier',
  'pricing profile',
  'billing console',
  'finance',
  'non-masking',
  'raw sender',
  'TTL',
  'lot expiry',
];

describe('moneyBilling words', () => {
  it.each([
    ['en', en],
    ['bn', bn],
  ])('%s has no never-say word', (_l, json) => {
    const hits = strings(json).filter((s) =>
      never.some((w) => new RegExp(`\\b${w}\\b`, 'i').test(s)),
    );
    expect(hits).toEqual([]);
  });

  it('bn and en have the same keys', () => {
    expect(keys(bn)).toEqual(keys(en));
  });
});
