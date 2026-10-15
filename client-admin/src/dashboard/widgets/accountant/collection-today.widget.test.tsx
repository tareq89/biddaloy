import '@biddaloy/ui/test';

import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import Widget, { widgetKey } from './collection-today.widget';

const URL = '/api/v1/dashboard/widgets/collection-today';

const BASE = {
  date: '2026-10-07',
  net: 48500,
  payment_count: 23,
  yesterday_same_time_net: 41200,
  groups: [
    {
      group: 'CASH',
      net: 22000,
      payment_count: 11,
      methods: [{ payment_method: 'CASH', net: 22000, payment_count: 11 }],
    },
    {
      group: 'BKASH',
      net: 6500,
      payment_count: 5,
      methods: [{ payment_method: 'BKASH', net: 6500, payment_count: 5 }],
    },
    {
      group: 'BANK',
      net: 20000,
      payment_count: 7,
      methods: [
        { payment_method: 'CHEQUE', net: 12000, payment_count: 3 },
        { payment_method: 'BANK_TRANSFER', net: 5000, payment_count: 2 },
        { payment_method: 'CARD', net: 3000, payment_count: 2 },
      ],
    },
    { group: 'OTHER_MOBILE', net: 0, payment_count: 0, methods: [] },
  ],
};

function renderWidget(variant: 'full' | 'compact' | 'tile', locale = 'en') {
  const root = createRootRoute();
  const index = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => <Widget variant={variant} size="M" />,
  });
  return renderWithRouter(root.addChildren([index]), {
    locale,
    role: 'ACCOUNTANT',
    tenantId: 'tenant-1',
  });
}
const serve = (body: object) => server.use(http.get(URL, () => HttpResponse.json(body)));

describe('collection-today widget', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('exports its key', () => {
    expect(widgetKey).toBe('collection-today');
  });

  it('full (bn): groups in server order with translated labels, never raw enums', async () => {
    serve(BASE);
    renderWidget('full', 'bn');
    expect((await screen.findAllByText('ক্যাশ')).length).toBeGreaterThan(0);
    expect(screen.queryByText('CASH')).toBeNull();
    expect(screen.queryByText('নগদ')).toBeNull();
    const groups = screen.getAllByTestId('group-label').map((e) => e.textContent);
    expect(groups).toEqual(['ক্যাশ', 'বিকাশ', 'ব্যাংক', 'অন্য মোবাইল']);
  });

  it('full (en): BANK shows its three method lines with net and count; zero group not in bar', async () => {
    serve(BASE);
    renderWidget('full');
    await screen.findByText('Yesterday at this time: ৳41,200.00');
    const bank = screen.getByTestId('group-BANK');
    expect(within(bank).getByText('Cheque')).toBeTruthy();
    expect(within(bank).getByText('Bank transfer')).toBeTruthy();
    expect(within(bank).getByText('Card')).toBeTruthy();
    expect(within(bank).getByText('৳12,000.00 · 3 payments')).toBeTruthy();
    expect(screen.getAllByTestId('stacked-bar-segment')).toHaveLength(3);
    expect(screen.getByText('Most came by Cash.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Collections report' }).getAttribute('href')).toBe(
      '/reports/collections',
    );
  });

  it('table keeps zero groups and indents method rows', async () => {
    serve(BASE);
    renderWidget('full');
    await screen.findByText('Most came by Cash.');
    await userEvent.click(screen.getByRole('button', { name: 'Show table' }));
    // header + 4 groups + 5 method rows
    expect(screen.getAllByRole('row')).toHaveLength(10);
    expect(screen.getAllByText('Other mobile').length).toBeGreaterThan(0);
  });

  it('yesterday null -> vsYesterdayNone', async () => {
    serve({ ...BASE, yesterday_same_time_net: null });
    renderWidget('full');
    expect(await screen.findByText('Yesterday at this time: —')).toBeTruthy();
  });

  it('all zero -> empty reason, no bar', async () => {
    serve({
      ...BASE,
      net: 0,
      payment_count: 0,
      groups: BASE.groups.map((g) => ({ ...g, net: 0, payment_count: 0, methods: [] })),
    });
    renderWidget('full');
    expect(await screen.findByText('No payment yet today.')).toBeTruthy();
    expect(screen.queryAllByTestId('stacked-bar-segment')).toHaveLength(0);
  });

  it('tile: net and an up trend vs yesterday', async () => {
    serve(BASE);
    renderWidget('tile');
    expect(await screen.findByText('৳48,500.00')).toBeTruthy();
    expect(screen.getByText('৳7,300.00 vs yesterday').parentElement?.className).toContain(
      'text-status-paid-fg',
    );
  });

  it('tile: below yesterday -> bad tone', async () => {
    serve({ ...BASE, yesterday_same_time_net: 60000 });
    renderWidget('tile');
    expect(await screen.findByText('৳11,500.00 vs yesterday')).toBeTruthy();
  });

  it('compact: net, count and top-group sentence', async () => {
    serve(BASE);
    renderWidget('compact');
    expect(await screen.findByText('৳48,500.00')).toBeTruthy();
    expect(screen.getByText(/23 payments/)).toBeTruthy();
    expect(screen.getByText(/Most came by Cash\./)).toBeTruthy();
  });

  it('error: Retry fires a second request', async () => {
    let calls = 0;
    server.use(
      http.get(URL, () => {
        calls += 1;
        return HttpResponse.json(
          { statusCode: 404, message: 'x', timestamp: '', path: '', requestId: '' },
          { status: 404 },
        );
      }),
    );
    renderWidget('full');
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(calls).toBe(2));
  });
});
