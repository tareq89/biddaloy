import '@biddaloy/ui/test';

import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import Widget, { widgetKey } from './fee-generation-status.widget';

const URL = '/api/v1/dashboard/widgets/fee-generation-status';

const GENERATED = {
  period: '2026-10',
  generated: true,
  first_generated_at: '2026-10-01T00:00:12.000Z',
  bill_count: 412,
  batch_count: 1,
  next_scheduled_run: '2026-11-01',
};
const NOT_GENERATED = {
  ...GENERATED,
  generated: false,
  first_generated_at: null,
  bill_count: 0,
  batch_count: 0,
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

describe('fee-generation-status widget', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('exports its key', () => {
    expect(widgetKey).toBe('fee-generation-status');
  });

  it('generated: success badge with formatted date, bill count, outline /invoices, no primary', async () => {
    serve(GENERATED);
    renderWidget('full');
    expect(await screen.findByText('Generated 1st October, 2026')).toBeTruthy();
    expect(screen.getByText('412')).toBeTruthy();
    expect(screen.getByText('The next one runs on its own on 1st November, 2026.')).toBeTruthy();
    const link = screen.getByRole('link', { name: 'See bills' });
    expect(link.getAttribute('href')).toBe('/invoices');
    expect(link.className).toContain('border');
    expect(screen.queryByRole('link', { name: 'Generate fees' })).toBeNull();
  });

  it('not generated: warning badge and ONE primary to /fees/generate?generate=1', async () => {
    serve(NOT_GENERATED);
    renderWidget('full');
    expect(await screen.findByText('Not generated yet')).toBeTruthy();
    const link = screen.getByRole('link', { name: 'Generate fees' });
    expect(link.getAttribute('href')).toBe('/fees/generate?generate=1');
    expect(screen.queryByRole('link', { name: 'See bills' })).toBeNull();
  });

  it('next_scheduled_run null -> noSchedule', async () => {
    serve({ ...GENERATED, next_scheduled_run: null });
    renderWidget('full');
    expect(await screen.findByText('No schedule for next month.')).toBeTruthy();
  });

  it('compact: bill count and badge', async () => {
    serve(GENERATED);
    renderWidget('compact');
    expect(await screen.findByText('412')).toBeTruthy();
  });

  it('error shows Retry', async () => {
    server.use(http.get(URL, () => HttpResponse.json({ message: 'x' }, { status: 404 })));
    renderWidget('full');
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});
