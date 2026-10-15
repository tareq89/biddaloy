import '@biddaloy/ui/test';

import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import Widget, { widgetKey } from './reminders-pending.widget';

const URL = '/api/v1/dashboard/widgets/reminders-pending';
const BASE = { student_count: 38, guardian_count: 31, oldest_threshold_date: '2026-09-10' };

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

describe('reminders-pending widget', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('exports its key', () => {
    expect(widgetKey).toBe('reminders-pending');
  });

  it('38 -> count, sentence, since date, ONE primary to /communications/reminders', async () => {
    serve(BASE);
    renderWidget('full');
    expect(await screen.findByText('38')).toBeTruthy();
    expect(
      screen.getByText('Their fees are overdue but no reminder has gone out yet.'),
    ).toBeTruthy();
    expect(screen.getByText('Oldest since 10th September, 2026')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Send reminders' }).getAttribute('href')).toBe(
      '/communications/reminders',
    );
  });

  it('0 -> empty reason, no button', async () => {
    serve({ ...BASE, student_count: 0, guardian_count: 0, oldest_threshold_date: null });
    renderWidget('full');
    expect(await screen.findByText('Everyone overdue has been reminded.')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Send reminders' })).toBeNull();
  });

  it('tile: student count', async () => {
    serve(BASE);
    renderWidget('tile');
    expect(await screen.findByText('38')).toBeTruthy();
    expect(screen.getByText('Reminders pending')).toBeTruthy();
  });

  it('compact: count and sentence', async () => {
    serve(BASE);
    renderWidget('compact');
    expect(await screen.findByText('38')).toBeTruthy();
    expect(
      screen.getByText('Their fees are overdue but no reminder has gone out yet.'),
    ).toBeTruthy();
  });

  it('error shows Retry', async () => {
    server.use(http.get(URL, () => HttpResponse.json({ message: 'x' }, { status: 404 })));
    renderWidget('full');
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});
