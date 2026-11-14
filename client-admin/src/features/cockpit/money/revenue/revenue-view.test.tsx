import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import bn from '../../../../../../ui/src/i18n/locales/bn/moneyRevenue.json';
import en from '../../../../../../ui/src/i18n/locales/en/moneyRevenue.json';

import { RevenueView, type RevenueViewProps } from './revenue-view';
import { VatDialog } from './vat-dialog';

afterEach(async () => {
  await cleanupTestState();
});

/** A one-page router so `Link` resolves; the school route is only a link target. */
function renderWithRouter(ui: React.ReactElement, o: typeof opts) {
  const root = createRootRoute();
  const page = createRoute({ getParentRoute: () => root, path: '/', component: () => ui });
  const school = createRoute({ getParentRoute: () => root, path: '/schools/$schoolId' });
  const router = createRouter({
    routeTree: root.addChildren([page, school]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  return renderWithProviders(<RouterProvider router={router} />, o);
}

const opts = { locale: 'en', role: 'SUPER_ADMIN', tenantId: 'platform' } as const;
const report = {
  month: '2029-12',
  seat_income_paisa: 1_000_000,
  package_income_paisa: 100_000,
  refunds_paisa: 50_000,
  net_paisa: 1_050_000,
  paying_schools: 7,
  not_renewed: {
    items: [
      {
        school_id: 's1',
        name: 'Rose Valley',
        paid_until: '2029-11-30',
        days_since_ended: 14,
        plan: 'Standard',
      },
    ],
    next_cursor: null,
  },
};

const view = (over: Partial<RevenueViewProps> = {}) => {
  const props: RevenueViewProps = {
    month: '2029-12',
    onMonthChange: vi.fn(),
    report,
    onRetry: vi.fn(),
    onCsv: vi.fn(),
    onVat: vi.fn(),
    ...over,
  };
  renderWithRouter(<RevenueView {...props} />, opts);
  return props;
};

describe('RevenueView', () => {
  it('shows the numbers, refunds as a minus line, and the not-renewed school linking to its billing', async () => {
    view();
    expect(await screen.findByText('From seats')).toBeTruthy();
    expect(screen.getByText(/^-/)).toBeTruthy();
    expect(screen.getByText(/^[7৭]$/)).toBeTruthy();
    const link = screen.getAllByRole('link', { name: 'Open billing' })[0]!;
    expect(link.getAttribute('href')).toBe('/schools/s1');
  });

  it('empty not-renewed list, then CSV and VAT clicks call once', async () => {
    const props = view({ report: { ...report, not_renewed: { items: [], next_cursor: null } } });
    expect(await screen.findByText('Every school renewed')).toBeTruthy();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Download CSV' }));
    await user.click(screen.getByRole('button', { name: 'VAT on receipts' }));
    expect(props.onCsv).toHaveBeenCalledTimes(1);
    expect(props.onVat).toHaveBeenCalledTimes(1);
  });

  it('more schools: Show more calls once; zero refunds show no minus', async () => {
    const props = view({ hasMore: true, onMore: vi.fn(), report: { ...report, refunds_paisa: 0 } });
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Show more' }));
    expect(props.onMore).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/^-/)).toBeNull();
  });

  it('error shows a retry', async () => {
    const props = view({ report: undefined, error: true });
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Try again' }));
    expect(props.onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('VatDialog', () => {
  const setting = { enabled: true, rate_percent: 13, label: 'VAT', registration: null };

  it('rejects a rate over 50, then asks for the code and sends the percent', async () => {
    const seen: { token: string | null; body: unknown }[] = [];
    server.use(
      http.get('*/platform/money/vat', () => HttpResponse.json(setting)),
      http.put('*/platform/money/vat', async ({ request }) => {
        const token = request.headers.get('X-Approval-Token');
        seen.push({ token, body: await request.json() });
        return token
          ? HttpResponse.json(setting)
          : HttpResponse.json(
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
      }),
    );
    const user = userEvent.setup();
    renderWithRouter(<VatDialog open onOpenChange={vi.fn()} />, opts);
    expect(await screen.findByText(/Receipts already issued keep their VAT/)).toBeTruthy();
    const rate = await screen.findByLabelText('VAT (%)');
    await waitFor(() => expect((rate as HTMLInputElement).value).toBe('13'));
    await user.clear(rate);
    await user.type(rate, '51');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(en.vat.errors.rate)).toBeTruthy();
    expect(seen).toHaveLength(0);
    await user.clear(rate);
    await user.type(rate, '15.25');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(seen.length).toBeGreaterThan(0));
    expect(seen[0]!.body).toEqual({ enabled: true, rate_percent: 15.25, label: 'VAT' });
    // The code step appears after the first 403.
    expect(await screen.findByText(/code/i)).toBeTruthy();
  });

  it('the skip switch sends enabled false without a rate', async () => {
    const seen: unknown[] = [];
    server.use(
      http.get('*/platform/money/vat', () => HttpResponse.json(setting)),
      http.put('*/platform/money/vat', async ({ request }) => {
        seen.push(await request.json());
        return HttpResponse.json({}, { status: 403 });
      }),
    );
    const user = userEvent.setup();
    renderWithRouter(<VatDialog open onOpenChange={vi.fn()} />, opts);
    await waitFor(() =>
      expect(screen.getByLabelText<HTMLInputElement>('VAT (%)').value).toBe('13'),
    );
    await user.click(screen.getByRole('switch', { name: 'Do not show VAT on receipts' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(seen).toEqual([{ enabled: false }]));
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

describe('Revenue words', () => {
  it.each([
    ['en', en],
    ['bn', bn],
  ])('%s has no never-say word', (_l, json) => {
    expect(
      strings(json).filter((s) => never.some((w) => new RegExp(`\\b${w}\\b`, 'i').test(s))),
    ).toEqual([]);
  });
  it('bn and en have the same keys', () => {
    expect(keys(bn)).toEqual(keys(en));
  });
});
