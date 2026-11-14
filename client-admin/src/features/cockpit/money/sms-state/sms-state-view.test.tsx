import '@biddaloy/ui/test';

import { i18n } from '@biddaloy/ui/i18n';
import { cleanupTestState, renderWithProviders } from '@biddaloy/ui/test';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import bn from '../../../../../../ui/src/i18n/locales/bn/money.json';
import en from '../../../../../../ui/src/i18n/locales/en/money.json';
import { smsReportFixture } from '../../../../../../ui/src/test/msw/handlers/platform-money';
import { loadRouteNamespaces } from '../../../../route-loaders';

import { SmsStateView, type SmsStateViewProps } from './sms-state-view';

beforeAll(async () => {
  await i18n.changeLanguage('en');
  await loadRouteNamespaces('money');
});

afterEach(async () => {
  await cleanupTestState();
});

const base: SmsStateViewProps = {
  report: smsReportFixture,
  loading: false,
  onRetry: vi.fn(),
  onAction: vi.fn(),
  onOpenSchool: vi.fn(),
  onCsv: vi.fn(),
  layout: 'cards',
};
const view = (over: Partial<SmsStateViewProps> = {}) =>
  renderWithProviders(<SmsStateView {...base} {...over} />, { locale: 'en' });

describe('SmsStateView', () => {
  it('renders the action lines in the server order and each button fires its handler', async () => {
    const onAction = vi.fn();
    const user = userEvent.setup();
    view({ onAction });
    const items = within(screen.getByRole('region', { name: 'What to do' })).getAllByRole(
      'listitem',
    );
    expect(items.map((li) => li.getAttribute('data-tone'))).toEqual([
      'danger',
      'warning',
      'warning',
      'danger',
    ]);
    expect(items[0]!.textContent).toMatch(/only [8৮][0০][0০] SMS/);
    for (const [i, li] of items.entries()) {
      await user.click(within(li).getByRole('button'));
      expect(onAction).toHaveBeenLastCalledWith(smsReportFixture.actionLines[i]);
    }
    expect(onAction).toHaveBeenCalledTimes(4);
  });

  it('shows a warning line (not an error) for a stale company number', () => {
    view();
    const note = screen.getByRole('status');
    expect(note.textContent).toContain('is old');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says plainly when the company number is unknown', () => {
    view({
      report: {
        ...smsReportFixture,
        balance: { sms: null, kind: 'UNKNOWN', enteredAt: null, stale: false },
      },
    });
    expect(screen.getByRole('status').textContent).toContain('do not know');
  });

  it('shows the numbers in plain words with taka for money', () => {
    view();
    expect(screen.getByText('Bought from the company')).toBeTruthy();
    expect(screen.getByText('Sold, not used yet')).toBeTruthy();
    expect(screen.getByText('Profit').nextSibling?.textContent).toMatch(
      /[3৩][5৫],[0০]{3}\.[0০]{2}/,
    );
    expect(screen.getByText('Profit by package')).toBeTruthy();
  });

  it('shows the empty state when nothing has been sold', () => {
    view({
      report: {
        ...smsReportFixture,
        actionLines: [],
        schools: [],
        packages: [],
        totals: { ...smsReportFixture.totals, soldSms: 0 },
      },
    });
    expect(screen.getByText('No SMS sold yet')).toBeTruthy();
    expect(screen.getByText('Nothing to do right now.')).toBeTruthy();
  });

  it('lists schools as cards, worst first, with 44 px buttons', () => {
    view();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getAllByText(/School$/)[0]!.textContent).toBe('Rose Valley School');
    for (const b of screen.getAllByRole('button')) {
      expect(b.className).toContain('min-h-11');
    }
  });

  it('calls the CSV helper once per click', async () => {
    const onCsv = vi.fn();
    const user = userEvent.setup();
    view({ onCsv });
    await user.click(screen.getByRole('button', { name: 'Download CSV' }));
    expect(onCsv).toHaveBeenCalledTimes(1);
  });

  it('shows a retry on error', async () => {
    const onRetry = vi.fn();
    const user = userEvent.setup();
    view({ error: en.sms.loadError, onRetry });
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

/** D15: the glossary's never-say words, by whole word, in both languages. */
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
  'tier',
  'pricing profile',
  'billing console',
  'finance',
  'non-masking',
  'raw sender',
  'ttl',
  'lot expiry',
  'coupon engine',
];
const strings = (tree: unknown): string[] =>
  typeof tree === 'string' ? [tree] : Object.values(tree as object).flatMap(strings);
const keys = (tree: unknown, p = ''): string[] =>
  typeof tree === 'string'
    ? [p]
    : Object.entries(tree as object).flatMap(([k, v]) => keys(v, p ? `${p}.${k}` : k));

describe('money.json', () => {
  it('has the same keys in bn and en', () => {
    expect(keys(bn).sort()).toEqual(keys(en).sort());
  });
  it.each([
    ['en', en],
    ['bn', bn],
  ])('%s has no never-say word', (_l, tree) => {
    for (const s of strings(tree)) {
      for (const w of NEVER) {
        expect(new RegExp(`\\b${w}\\b`, 'i').test(s), `${w} in "${s}"`).toBe(false);
      }
    }
  });
});
