import { UserRole } from '@biddaloy/shared';
import { cleanupTestState, renderWithRouter } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

import { moneyTabOf } from './money-tabs';

afterEach(async () => {
  await cleanupTestState();
});

describe('moneyTabOf', () => {
  it('maps a pathname to its tab, defaulting to SMS state', () => {
    expect(moneyTabOf('/money')).toBe('sms');
    expect(moneyTabOf('/money/')).toBe('sms');
    expect(moneyTabOf('/money/plans')).toBe('plans');
    expect(moneyTabOf('/money/revenue/')).toBe('revenue');
  });
});

describe('MoneyTabs', () => {
  it('shows the five tabs as links, the first one current', async () => {
    renderWithRouter(routeTree, {
      initialEntries: ['/money'],
      tenantId: 'tenant-1',
      role: UserRole.SUPER_ADMIN,
      locale: 'en',
    });
    const tabs = await screen.findAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual([
      'SMS state',
      'SMS packages',
      'Plans',
      'Coupons',
      'Revenue',
    ]);
    expect(tabs.map((t) => t.getAttribute('href'))).toEqual([
      '/money',
      '/money/packages',
      '/money/plans',
      '/money/coupons',
      '/money/revenue',
    ]);
    expect(tabs[0]!.getAttribute('aria-current')).toBe('page');
  });
});
