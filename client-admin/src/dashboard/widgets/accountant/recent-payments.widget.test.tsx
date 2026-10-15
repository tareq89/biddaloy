import '@biddaloy/ui/test';

import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Widget, { widgetKey } from './recent-payments.widget';

const URL = '/api/v1/dashboard/widgets/recent-payments';

const row = (i: number, over: object = {}) => ({
  payment_id: `p-${i}`,
  student_name: `Student ${i}`,
  class_name: 'Class 6',
  section_name: 'A',
  amount: 1000 * (i + 1),
  payment_method: i % 2 ? 'BKASH' : 'CASH',
  payment_status: 'SUCCESS',
  payment_date: '2026-10-07T04:06:00.000Z',
  ...over,
});
const BASE = { total_of_shown: 15000, items: [0, 1, 2, 3, 4].map((i) => row(i)) };

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

describe('recent-payments widget', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-07T04:16:00Z'));
  });
  afterEach(async () => {
    vi.useRealTimers();
    await cleanupTestState();
  });

  it('exports its key', () => {
    expect(widgetKey).toBe('recent-payments');
  });

  it('5 rows in a semantic table: bn method labels, no raw enums or ISO, amounts right-aligned', async () => {
    serve(BASE);
    renderWidget('full', 'bn');
    const table = await screen.findByRole('table');
    expect(within(table).getAllByRole('columnheader')).toHaveLength(5);
    expect(within(table).getAllByRole('row')).toHaveLength(6);
    expect(within(table).getAllByText('বিকাশ').length).toBeGreaterThan(0);
    expect(within(table).getAllByText('ক্যাশ').length).toBeGreaterThan(0);
    expect(table.textContent).not.toContain('BKASH');
    expect(table.textContent).not.toContain('2026-10-07');
    const amountCell = within(table).getByText('৳১,০০০.০০').closest('td')!;
    expect(amountCell.className).toContain('text-right');
  });

  it('en: total, latest sentence and link', async () => {
    serve(BASE);
    renderWidget('full');
    expect(await screen.findByText('৳15,000.00')).toBeTruthy();
    expect(screen.getByText(/Latest came 10 minutes ago, by Cash\./)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'All payments' }).getAttribute('href')).toBe(
      '/payments',
    );
  });

  it('student_name null -> unknownStudent', async () => {
    serve({ ...BASE, items: [row(0, { student_name: null }), ...BASE.items.slice(1)] });
    renderWidget('full');
    expect(await screen.findByText('Removed student')).toBeTruthy();
  });

  it('non-SUCCESS rows show their status, since the total only counts SUCCESS', async () => {
    serve({
      total_of_shown: 14000,
      items: [row(0, { payment_status: 'FAILED' }), ...BASE.items.slice(1)],
    });
    renderWidget('full');
    expect(await screen.findByText('Failed, not in the total')).toBeTruthy();
    expect(screen.getAllByText(/not in the total/)).toHaveLength(1);
  });

  it('phone: only the first 3 rows stay visible (the rest are md-only)', async () => {
    serve(BASE);
    renderWidget('full');
    const rows = (await screen.findAllByRole('row')).slice(1);
    expect(rows.map((r) => r.classList.contains('hidden'))).toEqual([
      false,
      false,
      false,
      true,
      true,
    ]);
  });

  it('empty', async () => {
    serve({ total_of_shown: 0, items: [] });
    renderWidget('full');
    expect(await screen.findByText('No payments yet.')).toBeTruthy();
  });

  it('compact: total and latest N minutes ago', async () => {
    serve(BASE);
    renderWidget('compact');
    expect(await screen.findByText('৳15,000.00')).toBeTruthy();
    expect(screen.getByText(/10 minutes ago/)).toBeTruthy();
  });

  it('error shows Retry', async () => {
    server.use(http.get(URL, () => HttpResponse.json({ message: 'x' }, { status: 404 })));
    renderWidget('full');
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});
