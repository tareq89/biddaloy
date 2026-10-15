import '@biddaloy/ui/test';

import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import Widget, { widgetKey } from './dues-ageing.widget';

const URL = '/api/v1/dashboard/widgets/dues-ageing';

const BASE = {
  as_of: '2026-10-07',
  total_due: 386000,
  buckets: [
    { bucket: '0_30', amount: 192000, share_pct: 50 },
    { bucket: '31_60', amount: 118000, share_pct: 31 },
    { bucket: '60_PLUS', amount: 76000, share_pct: 20 },
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

describe('dues-ageing widget', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('exports its key', () => {
    expect(widgetKey).toBe('dues-ageing');
  });

  it('full: total, 60+ sentence, translated bucket labels with amount and share, link', async () => {
    serve(BASE);
    renderWidget('full');
    expect(await screen.findByText('৳3,86,000.00')).toBeTruthy();
    expect(
      screen.getByText(
        '৳76,000.00 of it is more than two months old — the later, the harder to collect.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('0–30 days')).toBeTruthy();
    expect(screen.getByText('31–60 days')).toBeTruthy();
    expect(screen.getByText('60+ days')).toBeTruthy();
    expect(screen.queryByText('60_PLUS')).toBeNull();
    expect(screen.getByText('৳1,92,000.00')).toBeTruthy();
    expect(screen.getByText('50%')).toBeTruthy();
    expect(screen.getByText('31%')).toBeTruthy();
    expect(screen.getByText('20%')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'See all dues' }).getAttribute('href')).toBe(
      '/fees/dues',
    );
  });

  it('table toggle shows three rows', async () => {
    serve(BASE);
    renderWidget('full');
    await screen.findByText('৳3,86,000.00');
    await userEvent.click(screen.getByRole('button', { name: 'Show table' }));
    expect(screen.getAllByRole('row')).toHaveLength(4);
  });

  it('zero total -> empty, no bar', async () => {
    serve({
      ...BASE,
      total_due: 0,
      buckets: BASE.buckets.map((b) => ({ ...b, amount: 0, share_pct: 0 })),
    });
    renderWidget('full');
    expect(await screen.findByText('No dues.')).toBeTruthy();
    expect(screen.queryAllByTestId('stacked-bar-segment')).toHaveLength(0);
  });

  it('tile: total with a 3-part bar', async () => {
    serve(BASE);
    renderWidget('tile');
    expect(await screen.findByText('৳3,86,000.00')).toBeTruthy();
    expect(screen.getAllByTestId('stacked-bar-segment')).toHaveLength(3);
  });

  it('compact: total and sentence', async () => {
    serve(BASE);
    renderWidget('compact');
    expect(await screen.findByText('৳3,86,000.00')).toBeTruthy();
    expect(screen.getByText(/more than two months old/)).toBeTruthy();
  });

  it('error: Retry is offered', async () => {
    server.use(http.get(URL, () => HttpResponse.json({ message: 'x' }, { status: 404 })));
    renderWidget('full');
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});
