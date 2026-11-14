import { UserRole } from '@biddaloy/shared';
import { cleanupTestState, renderWithRouter } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import bn from '../../../../../ui/src/i18n/locales/bn/moneyPackages.json';
import en from '../../../../../ui/src/i18n/locales/en/moneyPackages.json';
import { routeTree } from '../../../routeTree.gen';

afterEach(async () => {
  await cleanupTestState();
});

const render = (url = '/money/packages') =>
  renderWithRouter(routeTree, {
    initialEntries: [url],
    tenantId: 'tenant-1',
    role: UserRole.SUPER_ADMIN,
    locale: 'en',
  });

describe('/money/packages', () => {
  it('lists the packages with their on/off switch', async () => {
    render();
    expect(await screen.findByText('Starter 1000')).toBeTruthy();
    expect(screen.getAllByRole('switch').length).toBeGreaterThan(1);
  });

  it('?new=1 opens the new package dialog', async () => {
    render('/money/packages?new=1');
    expect(await screen.findByRole('dialog', { name: 'New SMS package' })).toBeTruthy();
  });
});

const strings = (v: unknown): string[] =>
  typeof v === 'string' ? [v] : Object.values(v as object).flatMap(strings);
const keys = (v: unknown, p = ''): string[] =>
  typeof v === 'string'
    ? [p]
    : Object.entries(v as object).flatMap(([k, x]) => keys(x, `${p}.${k}`));

// Glossary "Never say" column (D15), plus the ticket's list.
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
  'coupon',
];

describe('SMS packages words', () => {
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
