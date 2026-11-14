import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CouponListView, type CouponListViewProps } from './coupon-list-view';

afterEach(async () => {
  await cleanupTestState();
});

const coupon = (id: string, code: string, over: object = {}) => ({
  id,
  code,
  discount_kind: 'PERCENT' as const,
  percent: 50,
  fixed_paisa: null,
  max_months: 3,
  max_discount_paisa: null,
  min_order_paisa: null,
  scope: 'ALL' as const,
  max_uses: 5,
  uses_count: 2,
  per_school_max: 1,
  starts_at: '2029-01-01T00:00:00.000Z',
  ends_at: '2030-12-31T00:00:00.000Z',
  active: true,
  created_at: '2029-01-01T00:00:00.000Z',
  ...over,
});

const view = (over: Partial<CouponListViewProps> = {}) => {
  const props: CouponListViewProps = {
    coupons: [
      coupon('1', 'SPRING50'),
      coupon('2', 'OLDONE', { active: false, max_months: null, max_uses: null }),
    ],
    onRetry: vi.fn(),
    onNew: vi.fn(),
    onEdit: vi.fn(),
    onUsage: vi.fn(),
    onToggle: vi.fn(),
    ...over,
  };
  renderWithProviders(<CouponListView {...props} />, {
    locale: 'en',
    role: 'SUPER_ADMIN',
    tenantId: 'platform',
  });
  return props;
};

describe('CouponListView', () => {
  it('lists discount, months and uses, and keeps an off coupon with a visible Off note', async () => {
    view();
    expect(await screen.findAllByText('SPRING50')).not.toHaveLength(0);
    expect(screen.getAllByText('50%').length).toBeGreaterThan(0);
    expect(screen.getAllByText('First 3 months').length).toBeGreaterThan(0);
    expect(screen.getAllByText('2 of 5').length).toBeGreaterThan(0);
    expect(screen.getAllByText('All months').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Off').length).toBeGreaterThan(0);
    expect(
      screen.getByRole('switch', { name: 'Keep coupon OLDONE on' }).getAttribute('aria-checked'),
    ).toBe('false');
    expect(screen.queryByRole('button', { name: /delete/i })).toBeNull();
  });

  it('disable calls the handler once with the new state', async () => {
    const user = userEvent.setup();
    const props = view();
    await user.click(await screen.findByRole('switch', { name: 'Keep coupon SPRING50 on' }));
    expect(props.onToggle).toHaveBeenCalledTimes(1);
    expect(props.onToggle).toHaveBeenCalledWith(expect.objectContaining({ id: '1' }), false);
  });

  it('opens usage, edit and new', async () => {
    const user = userEvent.setup();
    const props = view();
    await user.click((await screen.findAllByRole('button', { name: 'Who used it' }))[0]!);
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]!);
    await user.click(screen.getByRole('button', { name: 'New coupon' }));
    expect(props.onUsage).toHaveBeenCalledWith(expect.objectContaining({ id: '1' }));
    expect(props.onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: '1' }));
    expect(props.onNew).toHaveBeenCalledTimes(1);
  });

  it('shows the empty state, a retry on error, and a fixed switch error', async () => {
    const user = userEvent.setup();
    view({ coupons: [] });
    expect(await screen.findByText('No coupons yet')).toBeTruthy();
    await cleanupTestState();
    const props = view({ error: true, switchError: true });
    expect(await screen.findByText('Could not change this coupon. Try again.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(props.onRetry).toHaveBeenCalledTimes(1);
  });
});
