import '@biddaloy/ui/test';

import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import Widget, { widgetKey } from './recent-activity.widget';

const URL = '/api/v1/dashboard/widgets/recent-activity';

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

const row = (id: number, over: Record<string, unknown> = {}) => ({
  id: `a${id}`,
  action: 'UPDATE',
  entity_type: 'Student',
  entity_label: null,
  performed_by_name: 'Rahim',
  created_at: minutesAgo(5),
  changed_field_count: 2,
  ...over,
});

function renderWidget(variant: 'full' | 'compact', locale = 'en') {
  const root = createRootRoute();
  const index = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => <Widget variant={variant} size="M" />,
  });
  return renderWithRouter(root.addChildren([index]), {
    locale,
    role: 'EXECUTIVE',
    tenantId: 'tenant-1',
  });
}
const serve = (items: object[]) => server.use(http.get(URL, () => HttpResponse.json({ items })));

describe('recent-activity widget', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('widgetKey', () => {
    expect(widgetKey).toBe('recent-activity');
  });

  it('UPDATE row → the audit-log page sentence, actor prefix, log link', async () => {
    serve([row(1)]);
    renderWidget('full');
    expect(await screen.findByText('Rahim: 2 details changed.')).toBeTruthy();
    expect(screen.getByText('5 minutes ago')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Full activity log' }).getAttribute('href')).toBe(
      '/audit-logs',
    );
  });

  it('CREATE uses the entity name; unknown action falls back to a plain default', async () => {
    serve([
      row(1, { action: 'CREATE', changed_field_count: null }),
      row(2, { action: 'SOMETHING_NEW', changed_field_count: null }),
    ]);
    renderWidget('full');
    expect(await screen.findByText('Rahim: A new student was added.')).toBeTruthy();
    expect(screen.getByText('Rahim: SOMETHING_NEW')).toBeTruthy();
  });

  it('missing actor → System', async () => {
    serve([row(1, { performed_by_name: null })]);
    renderWidget('full');
    expect(await screen.findByText(/^System: /)).toBeTruthy();
  });

  it('12 entries → 8 rows', async () => {
    serve(Array.from({ length: 12 }, (_, i) => row(i)));
    renderWidget('full');
    await screen.findAllByText(/Rahim: /);
    expect(screen.getAllByRole('listitem')).toHaveLength(8);
  });

  it('compact: newest sentence with relative time only', async () => {
    serve([row(1), row(2, { performed_by_name: 'Karim' })]);
    renderWidget('compact');
    expect(await screen.findByText(/Rahim: 2 details changed\. 5 minutes ago/)).toBeTruthy();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });

  it('bn: Bangla digits in relative time', async () => {
    serve([row(1)]);
    renderWidget('full', 'bn');
    expect(await screen.findByText(/৫/)).toBeTruthy();
  });

  it('empty → emptyReason', async () => {
    serve([]);
    renderWidget('full');
    expect(await screen.findByText('Nothing changed recently.')).toBeTruthy();
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
