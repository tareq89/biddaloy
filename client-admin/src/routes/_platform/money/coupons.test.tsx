import { UserRole } from '@biddaloy/shared';
import { cleanupTestState, renderWithRouter } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import bn from '../../../../../ui/src/i18n/locales/bn/moneyCoupons.json';
import en from '../../../../../ui/src/i18n/locales/en/moneyCoupons.json';
import { routeTree } from '../../../routeTree.gen';

afterEach(async () => {
  await cleanupTestState();
});

const render = (path: string) =>
  renderWithRouter(routeTree, {
    initialEntries: [path],
    tenantId: 'tenant-1',
    role: UserRole.SUPER_ADMIN,
    locale: 'en',
  });

describe('/money/coupons', () => {
  it('lists the coupons, an exhausted one included', async () => {
    render('/money/coupons');
    expect((await screen.findAllByText('WELCOME10')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('WELCOME20').length).toBeGreaterThan(0);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('?new=1 opens the new coupon dialog and clears the URL', async () => {
    const { router } = render('/money/coupons?new=1');
    expect(await screen.findByRole('dialog', { name: 'New coupon' })).toBeTruthy();
    await expect.poll(() => router.state.location.search).toEqual({});
  });
});

const strings = (v: unknown): string[] =>
  typeof v === 'string' ? [v] : Object.values(v as object).flatMap(strings);
const keys = (v: unknown, p = ''): string[] =>
  typeof v === 'string'
    ? [p]
    : Object.entries(v as object).flatMap(([k, x]) => keys(x, `${p}.${k}`));

// Glossary "Never say" column (D15) in full, plus the ticket's list. "coupon" is the UI word here.
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
  'engine',
  'redeem',
  'discount code',
];

describe('Coupons words', () => {
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
