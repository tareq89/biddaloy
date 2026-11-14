import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CouponUsage } from './coupon-usage';

afterEach(async () => {
  await cleanupTestState();
});

const coupon = { id: '11111111-1111-4111-8111-111111111111', code: 'spring50' } as never;
const show = () =>
  renderWithProviders(<CouponUsage coupon={coupon} onOpenChange={vi.fn()} />, {
    locale: 'en',
    role: 'SUPER_ADMIN',
    tenantId: 'platform',
  });

describe('CouponUsage', () => {
  it('shows uses, total discount in taka and the per-school rows', async () => {
    server.use(
      http.get('*/platform/coupons/:id/usage', () =>
        HttpResponse.json({
          uses: 5,
          totalDiscountPaisa: '150000',
          schools: {
            items: [
              { schoolId: 'a', schoolName: 'Rose Valley School', uses: 3, discountPaisa: '90000' },
              { schoolId: 'b', schoolName: 'Green Hill School', uses: 2, discountPaisa: '60000' },
            ],
            nextCursor: null,
          },
        }),
      ),
    );
    const { container } = show();
    expect(await screen.findByText('Who used coupon SPRING50')).toBeTruthy();
    expect(await screen.findByText('Rose Valley School')).toBeTruthy();
    expect(screen.getByText('Green Hill School')).toBeTruthy();
    expect(screen.getByText('5')).toBeTruthy();
    expect(screen.getAllByText(/1,500|১,৫০০/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/900|৯০০/).length).toBeGreaterThan(0);
    await expect(container).toHaveNoViolations();
  });

  it('empty usage says no school has used it', async () => {
    server.use(
      http.get('*/platform/coupons/:id/usage', () =>
        HttpResponse.json({
          uses: 0,
          totalDiscountPaisa: '0',
          schools: { items: [], nextCursor: null },
        }),
      ),
    );
    show();
    expect(await screen.findByText('No school has used it yet.')).toBeTruthy();
  });

  it('a load error shows one fixed sentence', async () => {
    server.use(
      http.get('*/platform/coupons/:id/usage', () =>
        HttpResponse.json({ statusCode: 500, message: 'secret detail' }, { status: 500 }),
      ),
    );
    show();
    expect(await screen.findByText('Could not load the usage. Try again.')).toBeTruthy();
    expect(screen.queryByText(/secret detail/)).toBeNull();
  });
});
