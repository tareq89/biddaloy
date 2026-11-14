import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GrantSeatsDialog } from './grant-seats-dialog';
import { RecordPaymentDialog } from './record-payment-dialog';
import { ReviveDialog } from './revive-dialog';
import { SchoolBilling } from './school-billing';

const SCHOOL_ID = 'school-1';
const ORDER = { id: 'order-1', seats: 40, months: 3 };
const opts = { locale: 'en', role: 'SUPER_ADMIN', tenantId: 'platform' } as const;

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

describe('RecordPaymentDialog', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  const url = `/api/v1/platform/billing/orders/${ORDER.id}/offline-payment`;
  const render = (onOpenChange = vi.fn()) =>
    renderWithProviders(
      <RecordPaymentDialog
        open
        onOpenChange={onOpenChange}
        schoolId={SCHOOL_ID}
        schoolName="Ananta School"
        order={ORDER}
      />,
      opts,
    );

  it('needs a slip number before anything is sent', async () => {
    let called = false;
    server.use(
      http.post(url, () => {
        called = true;
        return HttpResponse.json({ applied: true });
      }),
    );
    const { user } = render();
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Bank slip or receipt number'), 'x');
    await user.click(within(dialog).getByRole('button', { name: 'Mark as paid' }));
    expect(await within(dialog).findByText('Enter 3 to 100 characters.')).toBeTruthy();
    expect(called).toBe(false);
  });

  it('sends the method, reference and an idempotency key, then closes', async () => {
    let body: Record<string, unknown> = {};
    server.use(
      http.post(url, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ applied: true });
      }),
    );
    const onOpenChange = vi.fn();
    const { user } = render(onOpenChange);
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('radio', { name: 'Cash' }));
    await user.type(within(dialog).getByLabelText('Bank slip or receipt number'), 'RCPT-77');
    await user.click(within(dialog).getByRole('button', { name: 'Mark as paid' }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(body).toMatchObject({ method: 'OFFLINE_CASH', reference: 'RCPT-77' });
    expect(String(body['idempotency_key']).length).toBeGreaterThanOrEqual(8);
  });

  it("says a reused slip number is taken, in our words and not the server's", async () => {
    server.use(http.post(url, () => conflict('REFERENCE_IN_USE')));
    const { user } = render();
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Bank slip or receipt number'), 'SLIP-1');
    await user.click(within(dialog).getByRole('button', { name: 'Mark as paid' }));
    expect((await within(dialog).findByRole('alert')).textContent).toBe(
      'This number is already used for another order.',
    );
  });

  it('says a bKash payment may still complete when the server answers BKASH_PAYMENT_LIVE', async () => {
    server.use(http.post(url, () => conflict('BKASH_PAYMENT_LIVE')));
    const { user } = render();
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Bank slip or receipt number'), 'SLIP-2');
    await user.click(within(dialog).getByRole('button', { name: 'Mark as paid' }));
    expect((await within(dialog).findByRole('alert')).textContent).toContain(
      'started a bKash payment',
    );
  });
});

describe('GrantSeatsDialog', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  const url = `/api/v1/platform/billing/schools/${SCHOOL_ID}/grant`;
  const render = (onOpenChange = vi.fn()) =>
    renderWithProviders(
      <GrantSeatsDialog
        open
        onOpenChange={onOpenChange}
        schoolId={SCHOOL_ID}
        schoolName="Ananta School"
      />,
      opts,
    );

  it('blocks out-of-range seats, months and a short reason', async () => {
    let called = false;
    server.use(
      http.post(url, () => {
        called = true;
        return HttpResponse.json({});
      }),
    );
    const { user } = render();
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Seats'), '0');
    await user.type(within(dialog).getByLabelText('Months'), '25');
    await user.type(within(dialog).getByLabelText('Reason'), 'short');
    await user.click(within(dialog).getByRole('button', { name: 'Grant seats' }));

    expect(await within(dialog).findByText('Enter a whole number from 1 to 100000.')).toBeTruthy();
    expect(within(dialog).getByText('Enter a whole number from 1 to 24.')).toBeTruthy();
    expect(within(dialog).getByText('Write at least 10 characters.')).toBeTruthy();
    expect(called).toBe(false);
  });

  it('sends the grant with Bangla digits normalised, then closes', async () => {
    let body: Record<string, unknown> = {};
    server.use(
      http.post(url, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({});
      }),
    );
    const onOpenChange = vi.fn();
    const { user } = render(onOpenChange);
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Seats'), '২৫');
    await user.type(within(dialog).getByLabelText('Months'), '2');
    await user.type(within(dialog).getByLabelText('Reason'), 'Pilot agreed with the owner');
    await user.click(within(dialog).getByRole('button', { name: 'Grant seats' }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(body).toMatchObject({ seats: 25, months: 2, reason: 'Pilot agreed with the owner' });
    expect(typeof body['idempotency_key']).toBe('string');
  });
});

describe('ReviveDialog', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  const url = `/api/v1/platform/schools/${SCHOOL_ID}/revive`;

  it('shows the window-passed sentence for a school deleted too long ago', async () => {
    server.use(http.post(url, () => conflict('REVIVE_WINDOW_PASSED')));
    const { user } = renderWithProviders(
      <ReviveDialog open onOpenChange={vi.fn()} schoolId={SCHOOL_ID} schoolName="Ananta School" />,
      opts,
    );
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Reason'), 'School called us');
    await user.click(within(dialog).getByRole('button', { name: 'Revive' }));
    expect((await within(dialog).findByRole('alert')).textContent).toBe(
      'This school was deleted more than 90 days ago and cannot be revived.',
    );
  });

  it('sends the reason and closes', async () => {
    let body: unknown = null;
    server.use(
      http.post(url, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({});
      }),
    );
    const onOpenChange = vi.fn();
    const { user } = renderWithProviders(
      <ReviveDialog
        open
        onOpenChange={onOpenChange}
        schoolId={SCHOOL_ID}
        schoolName="Ananta School"
      />,
      opts,
    );
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Reason'), 'School called us');
    await user.click(within(dialog).getByRole('button', { name: 'Revive' }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(body).toEqual({ reason: 'School called us' });
  });
});

describe('SchoolBilling refund and plan actions', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  const seatOrder = (id: string, status: string, amount: number, over = {}) => ({
    id,
    school_id: SCHOOL_ID,
    seats: 10,
    months: 1,
    unit_price_paisa: 1000,
    amount_paisa: amount,
    period_start: '2026-11-01',
    period_end: '2026-12-01',
    status,
    method: null,
    receipt_number: null,
    paid_at: null,
    created_at: '2026-11-01T04:00:00.000Z',
    ...over,
  });
  const pkgOrder = (id: string, refundable: boolean, units_used: number) => ({
    id,
    status: refundable ? 'ACTIVE' : 'USED_UP',
    bundle_name: 'Starter',
    sms_count: 1000,
    amount_paisa: 35_000,
    receipt_number: 'SMR-1',
    paid_at: '2026-11-05T04:00:00.000Z',
    refunded_at: null,
    units_bought: 1000,
    units_used,
    refundable,
  });
  const detail = {
    id: SCHOOL_ID,
    name: 'Ananta School',
    status: 'ACTIVE',
    status_reason: null,
    deleted: false,
    seats_entitled: 10,
    seats_used: 5,
    paid_until: '2026-12-01',
    pending_orders: 1,
    plan: { id: 'plan-1', name: 'Standard', unit_price_paisa: 1000 },
    orders: [
      seatOrder('paid-1', 'PAID', 10_000),
      seatOrder('pending-1', 'PENDING', 10_000),
      seatOrder('refunded-1', 'REFUNDED', 10_000, { refunded_at: '2026-11-03T00:00:00.000Z' }),
      seatOrder('free-1', 'PAID', 0),
    ],
    bundle_orders: [pkgOrder('pkg-ok', true, 0), pkgOrder('pkg-used', false, 40)],
  };

  const render = () => {
    server.use(
      http.get(`*/platform/billing/schools/${SCHOOL_ID}`, () => HttpResponse.json(detail)),
      http.get('*/platform/plans', () =>
        HttpResponse.json([
          {
            id: 'plan-1',
            name: 'Standard',
            unit_price_paisa: 1000,
            active: true,
            is_default: true,
          },
        ]),
      ),
    );
    return renderWithProviders(
      <SchoolBilling schoolId={SCHOOL_ID} schoolName="Ananta School" />,
      opts,
    );
  };

  it('shows Refund only on paid rows with money, and a visible sentence on the free one', async () => {
    render();
    await screen.findByText('Plan: Standard, ৳১০.০০ per seat, per month');
    // seat table: one paid order with money; package table: one refundable package
    const buttons = screen.getAllByRole('button', { name: 'Refund' });
    expect(buttons).toHaveLength(2);
    expect(screen.getByText('This order was free, so there is nothing to refund.')).toBeTruthy();
    expect(
      screen.getByText('Some of this package is already used, so it cannot be refunded.'),
    ).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Record payment' })).toHaveLength(1);
  });

  it('opens the refund dialog from a seat row and a package row', async () => {
    const { user } = render();
    await screen.findByText('Plan: Standard, ৳১০.০০ per seat, per month');
    await user.click(screen.getAllByRole('button', { name: 'Refund' })[0]!);
    expect(await screen.findByText('Refund ৳১০০.০০?')).toBeTruthy();
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await user.click(screen.getAllByRole('button', { name: 'Refund' })[1]!);
    expect(await screen.findByText('Refund ৳৩৫০.০০?')).toBeTruthy();
  });

  it('opens the change-plan dialog from the plan line', async () => {
    const { user } = render();
    await user.click(await screen.findByRole('button', { name: 'Change plan' }));
    expect(await screen.findByText('Change plan for Ananta School')).toBeTruthy();
  });
});
