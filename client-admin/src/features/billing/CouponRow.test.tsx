import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { apiErrorBody } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CouponRow } from './CouponRow';

function setup(props: Partial<React.ComponentProps<typeof CouponRow>> = {}) {
  const onApplied = vi.fn();
  const view = renderWithProviders(
    <CouponRow seats={50} months={3} onApplied={onApplied} {...props} />,
    { locale: 'en', role: 'ADMIN', tenantId: 'school-1' },
  );
  return { onApplied, ...view };
}

async function apply(code: string) {
  await userEvent.click(await screen.findByRole('button', { name: 'Have a coupon?' }));
  await userEvent.type(screen.getByLabelText('Coupon code'), code);
  await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
}

const failWith = (status: number, code: string) =>
  server.use(
    http.post('/api/v1/billing/orders/preview', () =>
      HttpResponse.json(
        {
          ...apiErrorBody(status, 'x', '/api/v1/billing/orders/preview'),
          details: { code },
        },
        { status },
      ),
    ),
  );

afterEach(async () => {
  await cleanupTestState();
});

describe('CouponRow', () => {
  it('is collapsed by default, opens on request', async () => {
    setup();
    expect(await screen.findByRole('button', { name: 'Have a coupon?' })).toBeTruthy();
    expect(screen.queryByLabelText('Coupon code')).toBeNull();
  });

  it('opens at once with defaultOpen (?coupon=1)', async () => {
    setup({ defaultOpen: true });
    expect(await screen.findByLabelText('Coupon code')).toBeTruthy();
  });

  it('Apply calls preview and hands the result up with the upper-cased code', async () => {
    const { onApplied } = setup();
    await apply('half');
    await vi.waitFor(() =>
      expect(onApplied).toHaveBeenLastCalledWith(
        expect.objectContaining({
          code: 'HALF',
          preview: expect.objectContaining({ discountPaisa: 375_000, totalPaisa: 375_000 }),
        }),
      ),
    );
  });

  it('shows the same sentence for two different server reasons', async () => {
    setup();
    failWith(400, 'COUPON_NOT_VALID');
    await apply('NOPE1');
    const first = (await screen.findByRole('alert')).textContent;
    expect(first).toBe('This coupon cannot be used.');
    // A different reason (the mock default sends no code at all): still the same words.
    server.resetHandlers();
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect((await screen.findByRole('alert')).textContent).toBe(first);
  });

  it('a code shaped wrongly gets the same sentence without a request', async () => {
    setup();
    await apply('১২৩৪৫');
    expect((await screen.findByRole('alert')).textContent).toBe('This coupon cannot be used.');
  });

  it('too many tries has its own sentence', async () => {
    setup();
    failWith(429, 'COUPON_TRY_LATER');
    await apply('SPRING50');
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Too many tries, wait a little and try again.',
    );
  });

  it('clears the result when months change', async () => {
    const { onApplied, rerender } = setup();
    await apply('HALF');
    await vi.waitFor(() => expect(onApplied).toHaveBeenLastCalledWith(expect.anything()));
    rerender(<CouponRow seats={50} months={4} onApplied={onApplied} />);
    await vi.waitFor(() => expect(onApplied).toHaveBeenLastCalledWith(null));
  });

  it('a coupon-check outage reads as try later, not as an invalid code', async () => {
    setup();
    failWith(503, 'COUPON_CHECK_UNAVAILABLE');
    await apply('HALF');
    expect((await screen.findByRole('alert')).textContent).not.toBe('This coupon cannot be used.');
  });

  it('a preview answer that arrives after the code was edited is dropped', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    server.use(
      http.post('/api/v1/billing/orders/preview', async () => {
        await gate;
        return HttpResponse.json({
          listAmountPaisa: 1000,
          discountPaisa: 500,
          totalPaisa: 500,
          free: false,
        });
      }),
    );
    const { onApplied } = setup();
    await apply('HALF');
    await userEvent.type(screen.getByLabelText('Coupon code'), 'X');
    release();
    await new Promise((r) => setTimeout(r, 50));
    expect(onApplied).not.toHaveBeenCalledWith(expect.objectContaining({ code: 'HALF' }));
  });

  it('a submit rejection stops showing once the code is edited', async () => {
    const { rerender } = setup({ defaultOpen: true });
    rerender(<CouponRow seats={50} months={3} rejected onApplied={vi.fn()} />);
    expect(await screen.findByText('This coupon cannot be used.')).toBeTruthy();
    await userEvent.type(screen.getByLabelText('Coupon code'), 'A');
    expect(screen.queryByText('This coupon cannot be used.')).toBeNull();
  });

  it('reports the preview as pending while the request is in flight', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    server.use(
      http.post('/api/v1/billing/orders/preview', async () => {
        await gate;
        return HttpResponse.json({
          listAmountPaisa: 1,
          discountPaisa: 0,
          totalPaisa: 1,
          free: false,
        });
      }),
    );
    const onPendingChange = vi.fn();
    setup({ onPendingChange });
    await apply('HALF');
    await vi.waitFor(() => expect(onPendingChange).toHaveBeenLastCalledWith(true));
    release();
    await vi.waitFor(() => expect(onPendingChange).toHaveBeenLastCalledWith(false));
  });
});
