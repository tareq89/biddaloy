import '@biddaloy/ui/test';

import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import Widget, { widgetKey } from './my-leave-balance.widget';

const URL = '/api/v1/dashboard/widgets/my-leave-balance';

function renderWidget(variant: 'full' | 'compact' | 'tile', locale = 'en') {
  const root = createRootRoute();
  const index = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => <Widget variant={variant} size="M" />,
  });
  return renderWithRouter(root.addChildren([index]), {
    locale,
    role: 'TEACHER',
    tenantId: 'tenant-1',
  });
}
const serve = (body: object) => server.use(http.get(URL, () => HttpResponse.json(body)));

const BASE = {
  has_profile: true,
  year: 2026,
  total_quota_days: 12,
  total_used_days: 4,
  total_balance_days: 8,
  by_type: [],
};

describe('my-leave-balance widget', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('exports its key', () => {
    expect(widgetKey).toBe('my-leave-balance');
  });

  it('full: 8 left, meter 4 of 12, leave link', async () => {
    serve(BASE);
    renderWidget('full');
    expect(await screen.findByText('8')).toBeTruthy();
    expect(screen.getByText('4 of 12 days taken this year.')).toBeTruthy();
    const meter = screen.getByRole('meter');
    expect(meter.getAttribute('aria-valuenow')).toBe('4');
    expect(meter.getAttribute('aria-valuemax')).toBe('12');
    expect(screen.getByText('Taken 4')).toBeTruthy();
    expect(screen.getByText('Total 12')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Apply for leave' }).getAttribute('href')).toBe(
      '/attendance/staff/leave',
    );
  });

  it('quota 0 renders', async () => {
    serve({ ...BASE, total_quota_days: 0, total_used_days: 0, total_balance_days: 0 });
    renderWidget('full');
    expect(await screen.findByText('Total 0')).toBeTruthy();
    expect(screen.getByRole('meter')).toBeTruthy();
  });

  it('no profile: noProfile and no link', async () => {
    serve({ ...BASE, has_profile: false });
    renderWidget('full');
    expect(await screen.findByText('Your leave is not set up yet. Ask the office.')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('tile and compact render', async () => {
    serve(BASE);
    const { unmount } = renderWidget('tile');
    expect(await screen.findByText('8')).toBeTruthy();
    expect(screen.getByRole('meter')).toBeTruthy();
    unmount();
    renderWidget('compact');
    expect(await screen.findByText('4 of 12 days taken this year.')).toBeTruthy();
  });

  it('error: Retry refetches', async () => {
    let calls = 0;
    server.use(
      http.get(URL, () => {
        calls += 1;
        return HttpResponse.json({ statusCode: 500, message: 'x' }, { status: 500 });
      }),
    );
    renderWidget('full');
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(calls).toBeGreaterThanOrEqual(2));
  });
});
