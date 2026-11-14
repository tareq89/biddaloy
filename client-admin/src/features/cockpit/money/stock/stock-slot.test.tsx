import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import bn from '../../../../../../ui/src/i18n/locales/bn/moneyStock.json';
import en from '../../../../../../ui/src/i18n/locales/en/moneyStock.json';

import { StockSlot } from './stock-slot';

let search: Record<string, unknown> = {};
vi.mock('@tanstack/react-router', async (orig) => ({
  ...(await orig<typeof import('@tanstack/react-router')>()),
  useSearch: () => search,
  useNavigate: () => vi.fn(),
}));

const view = () =>
  renderWithProviders(<StockSlot />, { locale: 'en', role: 'SUPER_ADMIN', tenantId: 'platform' });

afterEach(async () => {
  search = {};
  await cleanupTestState();
});

describe('StockSlot', () => {
  it('renders without props: button, last entries and the average cost', async () => {
    view();
    expect(await screen.findByRole('button', { name: 'Record SMS bought' })).toBeTruthy();
    expect(await screen.findByText('2029-12-01')).toBeTruthy();
    // 2,500,000 paisa over 50,000 SMS = 50 paisa each
    expect(await screen.findByText(/[0০]\.[5৫][0০]/)).toBeTruthy();
  });

  it('opens the dialog from the button', async () => {
    const user = userEvent.setup();
    view();
    await user.click(await screen.findByRole('button', { name: 'Record SMS bought' }));
    expect(await screen.findByRole('dialog', { name: 'Record SMS bought' })).toBeTruthy();
  });

  it('opens the dialog from ?record=1', async () => {
    search = { record: '1' };
    view();
    expect(await screen.findByRole('dialog', { name: 'Record SMS bought' })).toBeTruthy();
  });
});

/** D15 / glossary: no never-say word in any bn or en string. */
describe('moneyStock locale', () => {
  const NEVER = [
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
    'ttl',
    'coupon engine',
  ];
  const read = (lng: string) => JSON.stringify(lng === 'en' ? en : bn);
  const keys = (n: unknown, p = ''): string[] =>
    typeof n === 'string'
      ? [p]
      : Object.entries(n as object).flatMap(([k, v]) => keys(v, p ? `${p}.${k}` : k));

  it.each(['en', 'bn'])('%s has no never-say word', (lng) => {
    const values = [...read(lng).matchAll(/:"([^"]*)"/g)].map((m) => m[1]!.toLowerCase());
    for (const word of NEVER)
      for (const v of values)
        expect(v, `${lng}: "${v}" says "${word}"`).not.toMatch(new RegExp(`\\b${word}\\b`));
  });

  it('en and bn carry the same keys', () => {
    expect(keys(bn).sort()).toEqual(keys(en).sort());
  });
});
